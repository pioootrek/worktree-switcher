// Test-only preload. Both baseline and controller use the same IPC observer.
// No timer, server, production import or environment-variable hook is installed.
let retained;
process.on("message", message => {
  if (message?.kind === "resource-sample") {
    const cpu = process.cpuUsage();
    process.send?.({ id: message.id, rssBytes: process.memoryUsage.rss(),
      cpuMicros: cpu.user + cpu.system, timeMs: performance.now() });
  } else if (message?.kind === "retain-memory") {
    // A bounded, touched allocation simulates retained data in this process.
    retained = Buffer.alloc(128 * 1024 * 1024, 0x5a);
    process.send?.({ id: message.id, retainedBytes: retained.length });
  }
});
