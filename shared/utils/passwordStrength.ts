/**
 * Password Strength Validator
 * Implements security best practices for password requirements
 */

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  checks: {
    hasMinLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
  };
  feedback: string[];
  label: 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';
  color: 'red' | 'orange' | 'yellow' | 'blue' | 'green';
}

const MIN_LENGTH = 8;

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const checks = {
    hasMinLength: password.length >= MIN_LENGTH,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>[\]\\';/`~_+=-]/.test(password)
  };

  // Calculate score (0-4)
  let score = 0;
  if (checks.hasMinLength) score++;
  if (checks.hasUppercase) score++;
  if (checks.hasLowercase) score++;
  if (checks.hasNumber) score++;
  if (checks.hasSpecial) score++;

  // Adjust score for length bonus
  if (password.length >= 12) score = Math.min(4, score + 0.5) as PasswordStrengthResult['score'];
  if (password.length >= 16) score = Math.min(4, score + 0.5) as PasswordStrengthResult['score'];

  // Generate feedback
  const feedback: string[] = [];
  if (!checks.hasMinLength) feedback.push(`Use at least ${MIN_LENGTH} characters`);
  if (!checks.hasUppercase) feedback.push('Add uppercase letters (A-Z)');
  if (!checks.hasLowercase) feedback.push('Add lowercase letters (a-z)');
  if (!checks.hasNumber) feedback.push('Include numbers (0-9)');
  if (!checks.hasSpecial) feedback.push('Add special characters (!@#$...)');
  if (password.length < 12 && password.length >= MIN_LENGTH) {
    feedback.push('Consider using 12+ characters for better security');
  }

  // Determine label and color
  const labels: PasswordStrengthResult['label'][] = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors: PasswordStrengthResult['color'][] = ['red', 'orange', 'yellow', 'blue', 'green'];

  const finalScore = Math.floor(Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;

  return {
    score: finalScore,
    checks,
    feedback,
    label: labels[finalScore],
    color: colors[finalScore]
  };
}

/**
 * Check if password meets minimum requirements
 */
export function meetsMinimumRequirements(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 6) errors.push('Password must be at least 6 characters');
  if (password.length > 100) errors.push('Password must be less than 100 characters');
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get color class for strength indicator
 */
export function getStrengthColorClass(color: PasswordStrengthResult['color']): string {
  const colorMap = {
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    yellow: 'bg-yellow-500',
    blue: 'bg-blue-500',
    green: 'bg-green-500'
  };
  return colorMap[color];
}

/**
 * Get text color class for strength label
 */
export function getStrengthTextClass(color: PasswordStrengthResult['color']): string {
  const colorMap = {
    red: 'text-red-400',
    orange: 'text-orange-400',
    yellow: 'text-yellow-400',
    blue: 'text-blue-400',
    green: 'text-green-400'
  };
  return colorMap[color];
}
