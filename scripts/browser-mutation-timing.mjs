export const submitEditorAndMeasureMutation = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const save = document.querySelector('.bookmark-editor button[type="submit"]');
        if (!(save instanceof HTMLButtonElement)) {
          reject(new Error('Editor Save control was not available.'));
          return;
        }
        const started = performance.now();
        let acknowledgement;
        const observer = new MutationObserver(() => {
          if (acknowledgement === undefined && document.querySelector('.write-status.pending')) {
            acknowledgement = performance.now() - started;
          }
          if (acknowledgement !== undefined && !document.querySelector('.bookmark-editor')) {
            observer.disconnect();
            resolve({ acknowledgement, completion: performance.now() - started });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        save.click();
        setTimeout(() => {
          observer.disconnect();
          reject(new Error('Mutation did not complete within five seconds.'));
        }, 5_000);
      }),
  );
