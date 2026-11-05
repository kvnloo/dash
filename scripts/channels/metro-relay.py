#!/usr/bin/env python3
"""Expose the loopback-only channel Metro on one host address (for example the
tailnet address) without a wildcard listener. Configuration comes from the
environment so no host data lives in the repository:

  DASH_CHANNEL_RELAY_HOST   address to listen on (required)
  DASH_CHANNEL_RELAY_PORT   port to listen on (required)
  DASH_CHANNEL_METRO_PORT   loopback Metro port to forward to (required)
"""
import asyncio
import os


async def pipe(source, destination):
    try:
        while data := await source.read(65536):
            destination.write(data)
            await destination.drain()
        if destination.can_write_eof():
            destination.write_eof()
    except (OSError, asyncio.CancelledError):
        pass


async def relay(reader, writer, upstream_port):
    upstream_writer = None
    try:
        upstream_reader, upstream_writer = await asyncio.open_connection("localhost", upstream_port)
        await asyncio.gather(pipe(reader, upstream_writer), pipe(upstream_reader, writer))
    except OSError:
        pass
    finally:
        writer.close()
        if upstream_writer:
            upstream_writer.close()


async def main():
    host = os.environ["DASH_CHANNEL_RELAY_HOST"]
    port = int(os.environ["DASH_CHANNEL_RELAY_PORT"])
    upstream = int(os.environ["DASH_CHANNEL_METRO_PORT"])
    server = await asyncio.start_server(lambda r, w: relay(r, w, upstream), host, port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
