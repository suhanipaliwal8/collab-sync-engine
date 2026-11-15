// Every `intervalMs` we ping each connection and expect a pong before the next round.
// A connection that stayed silent for a whole round is dead (laptop lost Wi-Fi, process
// killed...) even if TCP still looks open, so we terminate it. Its "close" event then
// removes it from the room and announces it left. Browsers answer pings automatically.
export function startHeartbeat(wss, intervalMs) {
  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false; // must be set back to true by a pong before the next round
      socket.ping();
    }
  }, intervalMs);
  timer.unref(); // this timer alone must not keep Node running

  return () => clearInterval(timer);
}