export class Logger {
  private static formatMessage(level: string, message: string, metadata?: Record<string, any>): string {
    const timestamp = new Date().toISOString();
    const metadataStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    return `[${timestamp}] [${level}] ${message}${metadataStr}`;
  }

  static info(message: string, metadata?: Record<string, any>): void {
    console.log(this.formatMessage('INFO', message, metadata));
  }

  static error(message: string, metadata?: Record<string, any>): void {
    console.error(this.formatMessage('ERROR', message, metadata));
  }

  static warn(message: string, metadata?: Record<string, any>): void {
    console.warn(this.formatMessage('WARN', message, metadata));
  }

  static debug(message: string, metadata?: Record<string, any>): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatMessage('DEBUG', message, metadata));
    }
  }
}

