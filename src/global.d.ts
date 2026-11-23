import type { RestirApi } from "./renderer";

declare global {
  interface Window {
    __RESTIR__: RestirApi;
  }
}

export {};
