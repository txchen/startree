// cf beta.12 can leave a Miniflare FSWatcher alive after a local D1 command.
// Await the official CLI entry point, flush its output, then preserve its exit code.
// Never use this finite-command adapter for dev servers or remote operations.
if (!process.argv.includes('--local') || process.argv[2] !== 'd1') {
  throw new Error('This adapter only supports finite local D1 commands.');
}
await import('../node_modules/cf/bin/cf');
await Promise.all([
  new Promise((resolve) => process.stdout.write('', resolve)),
  new Promise((resolve) => process.stderr.write('', resolve)),
]);
process.exit(process.exitCode ?? 0);
