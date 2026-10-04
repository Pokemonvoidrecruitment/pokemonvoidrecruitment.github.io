import crypto from "node:crypto";

export function randomToken(bytes=32){ return crypto.randomBytes(bytes).toString("base64url"); }
export function sha256(value){ return crypto.createHash("sha256").update(value).digest("hex"); }
export function sign(value, secret){ return crypto.createHmac("sha256",secret).update(value).digest("hex"); }
export function safeEqual(a,b){ const x=Buffer.from(a||""); const y=Buffer.from(b||""); return x.length===y.length && crypto.timingSafeEqual(x,y); }
