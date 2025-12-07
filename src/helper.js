export const parseProxies = (proxyString) => {
//   proxyString = `
// 142.111.48.253:7030:jxllpsdg:mb9spxmgs299
// 31.59.20.176:6754:jxllpsdg:mb9spxmgs299
// 23.95.150.145:6114:jxllpsdg:mb9spxmgs299
// 198.23.239.134:6540:jxllpsdg:mb9spxmgs299
// 107.172.163.27:6543:jxllpsdg:mb9spxmgs299
// 198.105.121.200:6462:jxllpsdg:mb9spxmgs299
// 64.137.96.74:6641:jxllpsdg:mb9spxmgs299
// 84.247.60.125:6095:jxllpsdg:mb9spxmgs299
// 216.10.27.159:6837:jxllpsdg:mb9spxmgs299
// 142.111.67.146:5611:jxllpsdg:mb9spxmgs299`;

proxyString = ""

    return proxyString
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const parts = line.split(':');
        if (parts.length === 4) {
          return {
            host: parts[0],
            port: parseInt(parts[1], 10),
            username: parts[2],
            password: parts[3],
            // Format for proxy URL: http://username:password@host:port
            url: `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`
          };
        }
        return null;
      })
      .filter((p) => p !== null);
  };