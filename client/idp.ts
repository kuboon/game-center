/**
 * Where the browser talks to the IdP.
 *
 * The origin is baked into the bundle rather than read from the environment:
 * client code has no `Deno.env`, and the server passes its own configured
 * `idpOrigin` down as a prop wherever the two must agree.
 */

export const IDP_ORIGIN = "https://id.kbn.one";
