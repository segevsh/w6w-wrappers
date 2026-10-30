export default {
  actions: [
    { name: "send", description: "Send", execute() {}, validate() {} },
    { name: "list" },
  ],
  auth: [{ type: "apiKey", authenticate() {} }],
  triggers: [{ name: "onMessage", subscribe() {}, unsubscribe() {} }],
  healthChecks: [{ name: "ping", run() {} }],
};
