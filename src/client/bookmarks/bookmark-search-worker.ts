/// <reference lib="webworker" />

import {
  createMiniSearchBookmarkAdapter,
  type SearchWorkerRequest,
  type SearchWorkerResponse,
} from './bookmark-search';

const search = createMiniSearchBookmarkAdapter();

self.addEventListener('message', (event: MessageEvent<SearchWorkerRequest>) => {
  const respond = async (): Promise<SearchWorkerResponse> => {
    try {
      if (event.data.type === 'replace') {
        await search.replace(event.data.snapshot);
        return {
          requestId: event.data.requestId,
          type: 'replaced',
          revision: event.data.snapshot.revision,
        };
      }
      return {
        requestId: event.data.requestId,
        type: 'results',
        results: [...(await search.search(event.data.query, event.data.filters))],
      };
    } catch (error) {
      return {
        requestId: event.data.requestId,
        type: 'error',
        message: error instanceof Error ? error.message : 'Search failed.',
      };
    }
  };

  void respond().then((response) => self.postMessage(response));
});
