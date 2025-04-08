import winston from 'winston';
import util from 'util';

const MAX_OBJECT_DEPTH = 3; // Set desired depth

export function createLogger() {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format((info) => {
        // Handle additional parameters
        const additionalArgs = info[Symbol.for('splat')] || [];
        
        if (additionalArgs.length > 0) {
          info.additionalInfo = additionalArgs.map(obj => 
            util.inspect(obj, { depth: MAX_OBJECT_DEPTH })
          );
        }
        
        return info;
      })(),
      winston.format.printf((info) => {
        const { timestamp, level, message, additionalInfo, ...rest } = info;
        const ts = timestamp.slice(0, 19).replace('T', ' ');
        
        let log = `${ts} [${level}]: ${message}`;
        
        if (additionalInfo) {
          log += ' ' + additionalInfo.join(' ');
        }
        
        return log;
      })
    ),
    transports: [
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
      new winston.transports.File({ filename: 'combined.log' }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ]
  });
}
