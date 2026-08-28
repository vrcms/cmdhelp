const FRAMES = ['|', '/', '-', '\\'];

const ERASE_LINE = '\r\x1b[2K';

export function startSpinner(message: string): () => void {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${message}\n`);
    return () => undefined;
  }
  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${FRAMES[i % FRAMES.length]} ${message}`);
    i += 1;
  }, 100);
  return () => {
    clearInterval(timer);
    process.stderr.write(ERASE_LINE);
  };
}