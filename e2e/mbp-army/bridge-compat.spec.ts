import { expect, openChat, send, test } from './fixtures';

test('a bridge without UI control still connects and streams a chat', async ({ page, bridge }) => {
  let probes = 0;
  // Model the older wire contract, forwarding pairing, base WebSocket frames, and turns
  // to the isolated real bridge. A speculative UI-control hello gets a bad_message reply.
  await page.routeWebSocket(url => url.port === String(bridge.port) && url.pathname === '/ws', phone => {
    const server = phone.connectToServer();
    phone.onMessage(raw => {
      if (typeof raw === 'string' && JSON.parse(raw).type === 'ui_control_hello') {
        probes++;
        phone.send(JSON.stringify({ type: 'bad_message', message: 'Unknown type ui_control_hello' }));
        return;
      }
      server.send(raw);
    });
    server.onMessage(raw => {
      const frame = typeof raw === 'string' ? JSON.parse(raw) : null;
      if (frame?.type === 'hello') {
        phone.send(JSON.stringify({
          ...frame,
          features: (frame.features ?? []).filter((feature: string) => feature !== 'ui-control.v1'),
        }));
        // The real bridge must also tolerate an unknown client frame on the same connection.
        server.send(JSON.stringify({ type: 'army_future_feature' }));
        return;
      }
      phone.send(raw);
    });
  });

  await openChat(page, bridge);
  await send(page, 'ARMY legacy bridge chat');
  await expect(page.getByText('ARMY_REPLY: ARMY legacy bridge chat').first()).toBeVisible();
  await expect.poll(() => bridge.logs()).toContain('army_future_feature');
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });

  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
  await expect(page.getByText(/^Connected to /)).toBeVisible();
  const consent = page.getByRole('switch', { name: 'Agent control', exact: true });
  await consent.click();
  await expect(consent).toHaveText(/On$/);
  expect(probes).toBe(0);
});
