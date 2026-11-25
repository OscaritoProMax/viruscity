// Mutex asíncrono: las tareas corren de a una, en el orden en que llegaron (decisión 9: el líder serializa
// las escrituras). Un error en una tarea no bloquea a las siguientes.
//
// createMutex() → { run(fn) → Promise con el resultado de fn, pending() → tareas en cola o en curso }

function createMutex() {
    let tail = Promise.resolve();
    let pending = 0;
    return {
        run(fn) {
            pending += 1;
            const result = tail.then(() => fn());
            tail = result.then(
                () => undefined,
                () => undefined
            ).finally(() => {
                pending -= 1;
            });
            return result;
        },
        pending: () => pending,
    };
}

module.exports = { createMutex };
