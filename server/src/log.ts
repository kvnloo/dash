type Level = "info" | "warn" | "error";

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  const time = new Date().toISOString().slice(11, 19);
  const extra = fields ? ` ${JSON.stringify(fields)}` : "";
  process.stderr.write(`${time} ${level.padEnd(5)} ${message}${extra}\n`);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
};
