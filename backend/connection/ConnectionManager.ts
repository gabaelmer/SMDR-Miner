import { EventEmitter } from 'node:events';
import net from 'node:net';
import { ConnectionConfig, ConnectionEvent, ConnectionStatus } from '../../shared/types';
import { InputSanitizer } from '../security/InputSanitizer';

interface ConnectionManagerEvents {
  status: (status: ConnectionStatus) => void;
  line: (line: string) => void;
  event: (event: ConnectionEvent) => void;
}

const RECORD_HEADER_PATTERN = /^(?:@\d{8}@\s+)?(?:[%+\-])?(?:\d{2}[/-]\d{2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{6}|\d{8})\s+(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?P?|(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?P?)\b/;
const CONTINUATION_HINT_PATTERN = /^(?:\d{1,3}\b|[A-Z]\d{3,}\b|[*#0-9A-Za-z]+\s+\d{1,3}\b|\d+\s+[A-Z]\b)/;
const PENDING_RECORD_FLUSH_MS = 750;

export class ConnectionManager extends EventEmitter {
  private socket: net.Socket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private primaryProbeTimer: NodeJS.Timeout | null = null;
  private dataBuffer = '';
  private pendingRecordLine: string | null = null;
  private pendingRecordTimer: NodeJS.Timeout | null = null;
  private activeControllerIndex = 0;
  private stopped = true;

  constructor(private config: ConnectionConfig) {
    super();

    if (this.config.controllerIps.length === 0) {
      throw new Error('At least one controller IP is required');
    }
    if (this.config.concurrentConnections < 1 || this.config.concurrentConnections > 10) {
      throw new Error('MiVB supports between 1 and 10 concurrent SMDR connections');
    }
  }

  override on<U extends keyof ConnectionManagerEvents>(event: U, listener: ConnectionManagerEvents[U]): this {
    return super.on(event, listener);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getActiveController(): string {
    return this.config.controllerIps[this.activeControllerIndex] ?? this.config.controllerIps[0];
  }

  updateConfig(nextConfig: ConnectionConfig): void {
    const ipsChanged = JSON.stringify(this.config.controllerIps) !== JSON.stringify(nextConfig.controllerIps);
    const portChanged = this.config.port !== nextConfig.port;

    this.config = nextConfig;
    if (this.config.controllerIps.length === 0) {
      throw new Error('At least one controller IP is required');
    }
    if (this.config.concurrentConnections < 1 || this.config.concurrentConnections > 10) {
      throw new Error('MiVB supports between 1 and 10 concurrent SMDR connections');
    }

    if (this.activeControllerIndex >= this.config.controllerIps.length) {
      this.activeControllerIndex = 0;
    }

    if ((ipsChanged || portChanged) && !this.stopped) {
      this.log('info', 'Connection configuration changed. Restarting connection.');
      this.activeControllerIndex = 0; // Reset to primary of new list

      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.destroy();
        this.socket = null;
      }
      this.clearTimers();
      this.connectCurrent();
    }
  }

  start(): void {
    this.stopped = false;
    this.connectCurrent();
  }

  stop(): void {
    this.stopped = true;
    this.setStatus('disconnected');
    this.clearTimers();
    this.flushPendingRecord();

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  private connectCurrent(): void {
    const ip = this.getActiveController();
    if (!InputSanitizer.isWhitelistedIp(ip, this.config.ipWhitelist)) {
      this.log('warn', `Controller ${ip} rejected by whitelist. Rotating.`);
      this.rotateController();
      this.scheduleReconnect();
      return;
    }

    if (this.socket) {
      this.log('info', `Socket already exists, destroying old one before reconnecting to ${ip}`);
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }

    this.setStatus('retrying');
    this.log('info', `Connecting to MiVB ${ip}:${this.config.port}`);

    const socket = new net.Socket();
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10_000);
    socket.setTimeout(15000); // Increased from 3s for better stability

    socket.connect(this.config.port, ip);

    socket.on('connect', () => {
      this.socket = socket;
      this.dataBuffer = '';
      this.pendingRecordLine = null;
      this.clearPendingRecordTimer();
      this.setStatus('connected');

      // Disable idle timeout once connected to support systems with low call volume.
      // We rely on TCP KeepAlive (set above) for dead-peer detection.
      socket.setTimeout(0);

      this.log('info', `Connected to MiVB ${ip}:${this.config.port}`);

      if (this.activeControllerIndex !== 0 && this.config.autoReconnectPrimary) {
        this.schedulePrimaryProbe();
      }
    });

    socket.on('data', (data: Buffer) => {
      this.dataBuffer += data.toString('utf8');
      const lines = this.dataBuffer.split(/\r?\n/);
      this.dataBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const clean = InputSanitizer.sanitizeLine(line);
        if (clean.trim()) this.processIncomingLine(clean);
      }
    });

    socket.on('error', (error) => {
      this.log('error', `Socket error on ${ip}: ${error.message} (Status: ${this.status})`);
      this.setStatus('disconnected');
      socket.destroy();
    });

    socket.on('timeout', () => {
      this.log('warn', `Connection timeout for ${ip} (15s expired)`);
      this.setStatus('disconnected');
      if (this.socket === socket) this.socket = null;
      socket.destroy();
    });

    socket.on('close', (hadError) => {
      this.flushPendingRecord();
      if (this.socket === socket) {
        this.socket = null;
      }

      const statusBefore = this.status;
      if (this.stopped) {
        this.setStatus('disconnected');
        this.log('info', `Socket closed normally for ${ip} (stopped)`);
        return;
      }

      this.log('warn', `Socket closed for ${ip}. HadError: ${hadError}. Status was: ${statusBefore}`);
      this.rotateController();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    this.clearPrimaryProbe();
    if (!this.config.autoReconnect) {
      this.setStatus('disconnected');
      return;
    }

    this.clearReconnectTimer();
    this.setStatus('retrying');
    const delay = this.config.reconnectDelayMs || 5000;
    this.log('info', `Scheduling reconnect to ${this.getActiveController()} in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) {
        this.log('info', `Reconnect timer fired for ${this.getActiveController()}`);
        this.connectCurrent();
      }
    }, delay);
  }

  private schedulePrimaryProbe(): void {
    this.clearPrimaryProbe();
    this.primaryProbeTimer = setTimeout(() => {
      if (this.stopped || this.activeControllerIndex === 0 || this.status !== 'connected') return;
      this.probePrimaryAndFailback();
    }, this.config.primaryRecheckDelayMs || 120_000); // Increased default delay to 2m
  }

  private probePrimaryAndFailback(): void {
    const primaryIp = this.config.controllerIps[0];
    if (!primaryIp) return;

    const probe = new net.Socket();
    let switched = false;

    probe.setTimeout(10000);
    probe.connect(this.config.port, primaryIp);

    probe.on('connect', () => {
      switched = true;
      probe.destroy();
      this.log('info', `Primary controller ${primaryIp} recovered. Failing back.`);
      this.failbackToPrimary();
    });

    probe.on('error', (err) => {
      this.log('info', `Primary probe failed: ${err.message}`);
      probe.destroy();
    });

    probe.on('timeout', () => {
      this.log('info', `Primary probe timed out`);
      probe.destroy();
    });

    probe.on('close', () => {
      if (!switched) this.schedulePrimaryProbe();
    });
  }

  private failbackToPrimary(): void {
    this.activeControllerIndex = 0;

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }

    this.clearReconnectTimer();
    if (!this.stopped) this.connectCurrent();
  }

  private rotateController(): void {
    if (this.config.controllerIps.length <= 1) return;
    this.activeControllerIndex = (this.activeControllerIndex + 1) % this.config.controllerIps.length;
    this.log('info', `Switching failover target to ${this.getActiveController()}`);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPrimaryProbe(): void {
    if (this.primaryProbeTimer) {
      clearTimeout(this.primaryProbeTimer);
      this.primaryProbeTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearPrimaryProbe();
    this.clearPendingRecordTimer();
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  private log(level: ConnectionEvent['level'], message: string): void {
    this.emit('event', { level, message, createdAt: new Date().toISOString() });
  }

  private processIncomingLine(line: string): void {
    if (this.isRecordHeader(line)) {
      this.flushPendingRecord();
      this.pendingRecordLine = line;
      this.schedulePendingRecordFlush();
      return;
    }

    if (this.pendingRecordLine && this.isLikelyContinuation(line)) {
      const combined = `${this.pendingRecordLine} ${line}`;
      this.pendingRecordLine = combined;
      this.schedulePendingRecordFlush();
      return;
    }

    this.flushPendingRecord();

    // Fallback for single-line records that do not match known header formats.
    this.emit('line', line);
  }

  private isRecordHeader(line: string): boolean {
    return RECORD_HEADER_PATTERN.test(line.trimStart());
  }

  private isLikelyContinuation(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || this.isRecordHeader(trimmed)) return false;
    return CONTINUATION_HINT_PATTERN.test(trimmed);
  }

  private schedulePendingRecordFlush(): void {
    this.clearPendingRecordTimer();
    this.pendingRecordTimer = setTimeout(() => {
      this.flushPendingRecord();
    }, PENDING_RECORD_FLUSH_MS);
  }

  private clearPendingRecordTimer(): void {
    if (this.pendingRecordTimer) {
      clearTimeout(this.pendingRecordTimer);
      this.pendingRecordTimer = null;
    }
  }

  private flushPendingRecord(): void {
    this.clearPendingRecordTimer();
    if (this.pendingRecordLine) {
      const line = this.pendingRecordLine;
      this.pendingRecordLine = null;
      this.emit('line', line);
    }
  }
}
