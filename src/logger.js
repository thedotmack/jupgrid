import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
  ),
  transports: [
    new transports.File({ 
      filename: 'log.txt',
      maxsize: 5000000, // 5MB
      maxFiles: 5, // keep 5 rotated files
      tailable: true, // makes the newest file always be named 'log.txt'
    }),
  ],
});

export default logger;