type Env = { API: { fetch(request: Request): Promise<Response> } };
export default {
  fetch(request: Request, env: Env) {
    return env.API.fetch(request);
  },
};
