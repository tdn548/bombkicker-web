// One mock API per page, shared by the API client and the mock Unity (which "posts" match results).
import { createMockApi, type MockApi } from "./mock";

let instance: MockApi | null = null;

export function getMockApi(): MockApi {
  if (!instance) instance = createMockApi();
  return instance;
}
