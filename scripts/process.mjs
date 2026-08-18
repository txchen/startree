import { spawnSync } from 'node:child_process';

export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`,
    );
  }

  return result.stdout?.trim() ?? '';
};
