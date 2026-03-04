#!/usr/bin/env python3
"""Local network server for the creative testing dashboard.
Run: python3 server.py
Open from any device on the same network.
"""

import http.server
import socketserver
import socket
import os
import sys
import webbrowser
import errno

DEFAULT_PORT = 8899
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    """Get the machine's local network IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        client = self.address_string()
        print(f"  {client} — {args[0]}")

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

def find_available_port(start_port: int, attempts: int = 50) -> int:
    """Return the first free TCP port starting from start_port."""
    for port in range(start_port, start_port + max(1, attempts)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError as e:
                if e.errno == errno.EADDRINUSE:
                    continue
                raise
    return start_port

def main():
    local_ip = get_local_ip()
    port = find_available_port(DEFAULT_PORT)

    print()
    print("=" * 56)
    print("  Creative Testing Dashboard — Local Server")
    print("=" * 56)
    print()
    if port != DEFAULT_PORT:
        print(f"  Порт {DEFAULT_PORT} занят — использую {port}")
        print()
    print(f"  Этот компьютер:  http://localhost:{port}/dashboard.html")
    print(f"  Другие устройства: http://{local_ip}:{port}/dashboard.html")
    print()
    print("  Откройте ссылку выше на любом устройстве")
    print("  в той же Wi-Fi / локальной сети.")
    print()
    print("  Для остановки нажмите Ctrl+C")
    print("=" * 56)
    print()

    with ReusableTCPServer(("0.0.0.0", port), Handler) as httpd:
        try:
            webbrowser.open(f"http://localhost:{port}/dashboard.html")
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Сервер остановлен.")
            sys.exit(0)

if __name__ == "__main__":
    main()
