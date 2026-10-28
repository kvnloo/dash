import type { AcpPermissionBrokerPort } from "./permission-adapter";
import type { PermissionBroker, PermissionNotifier, PermissionScope } from "../permission-broker";

/**
 * Connects AcpPermissionAdapter (one per ACP stdio connection) to the host
 * PermissionBroker. The phone's decision names only turnId and requestId, so
 * the full broker scope of each open request is kept here until it settles.
 */
export class AcpPermissionRouter {
  private readonly open = new Map<string, PermissionScope>();

  constructor(
    private readonly broker: PermissionBroker,
    private readonly notify: PermissionNotifier,
  ) {}

  /** The structural port the adapter registers each request with. */
  readonly port: AcpPermissionBrokerPort = {
    register: (request, settle) => {
      const scope: PermissionScope = {
        authenticatedPrincipal: request.principalId,
        turnId: request.turnId,
        requestId: request.requestId,
        sessionId: request.sessionId,
      };
      const key = JSON.stringify([request.turnId, request.requestId]);
      this.open.set(key, scope);
      const registered = this.broker.register({
        ...scope,
        options: request.options,
        respond: response => { this.open.delete(key); settle(response.outcome); },
        notify: this.notify,
      });
      if (!registered) {
        this.open.delete(key);
        return null;
      }
      return () => { this.open.delete(key); this.broker.cancel(scope); };
    },
  };

  /** Select an exactly offered option. False when the request is unknown or already settled. */
  decide(turnId: string, requestId: string, optionId: string): boolean {
    const scope = this.open.get(JSON.stringify([turnId, requestId]));
    return scope ? this.broker.decide({ ...scope, optionId }) : false;
  }

  /** Re-send the open requests to a socket that reattached. Deadlines are not extended. */
  replay(principal: string): number {
    return this.broker.replay(principal, this.notify);
  }
}
