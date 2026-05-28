import net from 'net';
import http from 'http';

/**
 * Connect to a remote SOCKS5 proxy and complete handshake + authentication
 */
function connectSocks5({ socksHost, socksPort, username, password, targetHost, targetPort }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socksPort, socksHost);
    
    socket.on('error', (err) => reject(err));
    
    // Step 1: Handshake
    // Send SOCKS5 version and supported auth methods: 0x00 (no auth) and 0x02 (username/password)
    socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
    
    let stage = 'handshake';
    
    socket.on('data', (data) => {
      try {
        if (stage === 'handshake') {
          const version = data[0];
          const method = data[1];
          if (version !== 0x05) {
            throw new Error('Invalid SOCKS version received from proxy server');
          }
          
          if (method === 0x02) {
            // Username/Password authentication required
            if (!username) {
              throw new Error('SOCKS5 proxy requires authentication but no username was provided');
            }
            stage = 'auth';
            const userBuf = Buffer.from(username);
            const passBuf = Buffer.from(password || '');
            const authBuf = Buffer.alloc(3 + userBuf.length + passBuf.length);
            authBuf[0] = 0x01; // Subnegotiation version
            authBuf[1] = userBuf.length;
            userBuf.copy(authBuf, 2);
            authBuf[2 + userBuf.length] = passBuf.length;
            passBuf.copy(authBuf, 3 + userBuf.length);
            socket.write(authBuf);
          } else if (method === 0x00) {
            // No auth required
            sendConnectCommand();
          } else {
            throw new Error(`Unsupported SOCKS5 auth method selected by proxy: ${method}`);
          }
        } else if (stage === 'auth') {
          const status = data[1];
          if (status !== 0x00) {
            throw new Error('SOCKS5 authentication failed: invalid credentials');
          }
          sendConnectCommand();
        } else if (stage === 'connect') {
          const reply = data[1];
          if (reply !== 0x00) {
            throw new Error(`SOCKS5 connection request rejected with code: ${reply}`);
          }
          // Handshake complete, clear listeners and pass socket
          socket.removeAllListeners('data');
          socket.removeAllListeners('error');
          resolve(socket);
        }
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    });
    
    function sendConnectCommand() {
      stage = 'connect';
      
      const isIP = net.isIP(targetHost);
      let addrBuf;
      let addrType;
      
      if (isIP === 4) {
        addrType = 0x01; // IPv4
        addrBuf = Buffer.from(targetHost.split('.').map(Number));
      } else {
        addrType = 0x03; // Domain name
        const hostLen = Buffer.byteLength(targetHost);
        addrBuf = Buffer.alloc(1 + hostLen);
        addrBuf[0] = hostLen;
        Buffer.from(targetHost).copy(addrBuf, 1);
      }
      
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort, 0);
      
      const reqBuf = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, addrType]),
        addrBuf,
        portBuf
      ]);
      
      socket.write(reqBuf);
    }
  });
}

/**
 * Start a local HTTP-to-SOCKS5 bridge tunnel.
 * Returns the local port and server instance.
 */
export function startLocalProxyTunnel(socksConfig) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Local proxy tunnel only supports CONNECT method for HTTPS tunnel routing.');
    });
    
    server.on('connect', async (req, clientSocket, head) => {
      const parts = req.url.split(':');
      const targetHost = parts[0];
      const targetPort = parseInt(parts[1] || '443');
      
      // Parse target SOCKS5 host and port
      const socksServerClean = socksConfig.server.replace(/^(socks5:\/\/|http:\/\/|https:\/\/)/i, '');
      const socksParts = socksServerClean.split(':');
      const socksHost = socksParts[0];
      const socksPort = parseInt(socksParts[1] || '1080');
      
      try {
        const socksSocket = await connectSocks5({
          socksHost,
          socksPort,
          username: socksConfig.username,
          password: socksConfig.password,
          targetHost,
          targetPort
        });
        
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        
        if (head && head.length > 0) {
          socksSocket.write(head);
        }
        
        clientSocket.pipe(socksSocket);
        socksSocket.pipe(clientSocket);
        
        clientSocket.on('error', () => socksSocket.destroy());
        socksSocket.on('error', () => clientSocket.destroy());
        clientSocket.on('end', () => socksSocket.end());
        socksSocket.on('end', () => clientSocket.end());
      } catch (err) {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.destroy();
      }
    });
    
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: address.port,
        close: () => new Promise(cb => server.close(cb))
      });
    });
    
    server.on('error', (err) => {
      reject(err);
    });
  });
}
