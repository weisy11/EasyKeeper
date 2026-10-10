import net from "node:net";

/** True when something on 127.0.0.1 is already accepting connections. */
export function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (used) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(used);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** First port in [start, start + count) that is not accepting connections. */
export async function findFreePort(start, count = 30) {
  for (let port = start; port < start + count; port += 1) {
    if (!(await isPortInUse(port))) return port;
  }
  throw new Error(`no free port in ${start}–${start + count - 1}`);
}
