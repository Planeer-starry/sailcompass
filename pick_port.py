"""选一个可用端口：优先 8000-8009，全被占用则让系统分配。"""
import socket


def main() -> None:
    for port in range(8000, 8010):
        sock = socket.socket()
        try:
            sock.bind(("127.0.0.1", port))
            sock.close()
            print(port)
            return
        except OSError:
            sock.close()
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
    sock.close()


if __name__ == "__main__":
    main()