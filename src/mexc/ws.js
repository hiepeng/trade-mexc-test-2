import WebSocket from 'ws';

export const createWs = ({ url, onOpen, onMessage, onError, subscribePayloads = [] }) => {
  let ws;
  let reconnectTimer;

  const connect = () => {
    ws = new WebSocket(url);

    ws.on('open', () => {
      if (onOpen) {
        onOpen(ws);
      }
      // Send subscribe payloads if provided
      if (subscribePayloads && subscribePayloads.length > 0) {
        subscribePayloads.forEach((payload) => ws.send(JSON.stringify(payload)));
      }
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        onMessage?.(parsed, ws);
      } catch (err) {
        console.error('WS parse error', err, data.toString());
      }
    });

    ws.on('close', () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1000);
    });

    ws.on('error', (err) => {
      onError?.(err);
      ws.close();
    });
  };

  connect();
  return () => {
    clearTimeout(reconnectTimer);
    ws?.close();
  };
};
