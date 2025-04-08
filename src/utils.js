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
        const { timestamp, level, message, additionalInfo } = info;
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

export async function withRetry(operation, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}