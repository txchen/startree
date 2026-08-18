export const indexedDbRequest = <Result>(request: IDBRequest<Result>): Promise<Result> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
