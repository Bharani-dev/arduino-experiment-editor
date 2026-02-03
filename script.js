(function () {
  'use strict';

  const APP_STATE = {
    components: [],
    wires: [],
    nextId: 1
  };

  const canvas = document.getElementById('canvas');
  const wireLayer = document.getElementById('wire-layer');
  const codeDisplay = document.querySelector('#code-display code');
  const btnCircuit = document.getElementById('btn-circuit');
  const btnCode = document.getElementById('btn-code');
  const codePanel = document.querySelector('.code-panel');
  const canvasContainer = document.querySelector('.canvas-container');

  const ARDUINO_PINS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const PREF_LED_PIN = 10;
  const PREF_BTN_PIN = 2;

  btnCircuit.addEventListener('click', () => {
    btnCircuit.classList.add('active');
    btnCode.classList.remove('active');
    codePanel.classList.add('hidden');
    canvasContainer.style.flex = '1';
    setTimeout(redrawWires, 10);
  });

  btnCode.addEventListener('click', () => {
    btnCode.classList.add('active');
    btnCircuit.classList.remove('active');
    codePanel.classList.remove('hidden');
    redrawWires();
  });

  let draggedItem = null;
  let dragSource = null;
  let dragOffset = { x: 0, y: 0 };
  let pendingConnection = null;
  let isSimulationRunning = false;

  function init() {
    setupPalette();
    setupCanvas();
    generateCode();
  }

  function setupPalette() {
    document.querySelectorAll('.palette-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('type', item.dataset.type);
        e.dataTransfer.effectAllowed = 'copy';
        dragSource = 'palette';
      });
    });
  }

  function setupCanvas() {
    canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSource !== 'palette') return;

      const type = e.dataTransfer.getData('type');
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      addComponent(type, x, y);
      dragSource = null;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (isSimulationRunning) return;
      if (e.target.closest('.pin') || e.target.closest('.leg') || e.target.closest('.btn-leg')) return;

      const compEl = e.target.closest('.component');
      if (compEl) {
        const compId = parseInt(compEl.dataset.id);
        const comp = APP_STATE.components.find(c => c.id === compId);
        if (comp) {
          draggedItem = comp;
          dragSource = 'canvas';
          const rect = compEl.getBoundingClientRect();
          dragOffset.x = e.clientX - rect.left;
          dragOffset.y = e.clientY - rect.top;
          e.preventDefault();
        }
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (dragSource === 'canvas' && draggedItem) {
        const rect = canvas.getBoundingClientRect();
        let newX = e.clientX - rect.left - dragOffset.x;
        let newY = e.clientY - rect.top - dragOffset.y;

        newX = Math.max(0, Math.min(newX, rect.width - 50));
        newY = Math.max(0, Math.min(newY, rect.height - 50));

        draggedItem.x = newX;
        draggedItem.y = newY;

        updateComponentPos(draggedItem);
        redrawWires();
      }
    });

    document.addEventListener('mouseup', () => {
      draggedItem = null;
      dragSource = null;
    });

    window.addEventListener('resize', redrawWires);

    // Cancel wiring on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pendingConnection) {
        pendingConnection = null;
        document.body.style.cursor = 'default';
      }
    });
  }

  function addComponent(type, x, y) {
    if (type === 'arduino' && APP_STATE.components.some(c => c.type === 'arduino')) {
      alert("Only one Arduino Uno is allowed.");
      return;
    }

    const id = APP_STATE.nextId++;
    const el = document.createElement('div');
    el.classList.add('component', type);
    el.dataset.id = id;

    el.innerHTML = getComponentHTML(type);
    canvas.appendChild(el);

    const comp = { id, type, x, y, el };
    APP_STATE.components.push(comp);
    updateComponentPos(comp);

    attachTerminalListeners(el, comp);

    if (type !== 'arduino') {
      autoWireComponent(comp);
    } else {
      APP_STATE.components.forEach(c => {
        if (c.type !== 'arduino') autoWireComponent(c);
      });
    }

    generateCode();
  }

  function getComponentHTML(type) {
    if (type === 'arduino') {
      let pinsHTML = '<div class="pin-header">';
      for (let i = 13; i >= 2; i--) {
        pinsHTML += `<div class="pin" data-pin="${i}" data-label="D${i}" title="Digital Pin ${i}"></div>`;
      }
      pinsHTML += '</div><div class="usb"></div>';
      return pinsHTML;
    } else if (type === 'led') {
      return `
                <div class="led-bulb"></div>
                <div class="led-legs">
                    <div class="leg anode" data-term="anode" title="Anode (+)"></div>
                    <div class="leg cathode" data-term="cathode" title="Cathode (-)"></div>
                </div>
            `;
    } else if (type === 'button') {
      return `
                <div class="btn-cap"></div>
                <div class="btn-terminals">
                    <div class="btn-leg" data-term="t1" title="Terminal 1"></div>
                    <div class="btn-leg" data-term="t2" title="Terminal 2"></div>
                </div>
            `;
    }
    return '';
  }

  function updateComponentPos(comp) {
    comp.el.style.left = comp.x + 'px';
    comp.el.style.top = comp.y + 'px';
  }

  const TERMINALS = {
    'led': 'anode',
    'button': 't1'
  };

  function attachTerminalListeners(el, comp) {
    if (comp.type === 'arduino') {
      el.querySelectorAll('.pin').forEach(pinEl => {
        pinEl.addEventListener('mouseup', (e) => {
          e.stopPropagation();
          if (pendingConnection) {
            completeConnection(pendingConnection.compId, pendingConnection.terminal, parseInt(pinEl.dataset.pin));
          }
        });
      });
    } else {
      const selector = comp.type === 'led' ? '.leg' : '.btn-leg';
      el.querySelectorAll(selector).forEach(termEl => {
        termEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const termName = termEl.dataset.term;
          if (termName !== TERMINALS[comp.type]) return;

          startWiring(comp.id, termName);
        });
      });
    }
  }

  function startWiring(compId, terminal) {
    const arduino = APP_STATE.components.find(c => c.type === 'arduino');
    if (!arduino) {
      alert('Please place an Arduino on the canvas first.');
      return;
    }
    pendingConnection = { compId, terminal };
    document.body.style.cursor = 'crosshair';
  }

  function completeConnection(compId, terminal, pin) {
    const existingWireOwner = APP_STATE.wires.find(w => w.pin === pin);
    if (existingWireOwner) {
      APP_STATE.wires = APP_STATE.wires.filter(w => w.pin !== pin);
    }

    APP_STATE.wires = APP_STATE.wires.filter(w => !(w.compId === compId && w.terminal === terminal));
    APP_STATE.wires.push({ compId, terminal, pin });

    pendingConnection = null;
    document.body.style.cursor = 'default';

    redrawWires();
    generateCode();
  }

  function autoWireComponent(comp) {
    const arduino = APP_STATE.components.find(c => c.type === 'arduino');
    if (!arduino) return;

    const term = TERMINALS[comp.type];
    if (!term) return;

    // Check if this component already has a wire
    const existingWire = APP_STATE.wires.find(w => w.compId === comp.id && w.terminal === term);
    if (existingWire) return;

    let desiredPin = (comp.type === 'led') ? PREF_LED_PIN : PREF_BTN_PIN;
    let assignedPin = null;

    if (isPinFree(desiredPin)) {
      assignedPin = desiredPin;
    } else {
      for (let p of ARDUINO_PINS) {
        if (isPinFree(p)) {
          assignedPin = p;
          break;
        }
      }
    }

    if (assignedPin !== null) {
      APP_STATE.wires.push({ compId: comp.id, terminal: term, pin: assignedPin });
      redrawWires();
      generateCode();
    }
  }

  function isPinFree(pin) {
    return !APP_STATE.wires.some(w => w.pin === pin);
  }

  function redrawWires() {
    wireLayer.innerHTML = '';
    const canvasRect = canvas.getBoundingClientRect();

    document.querySelectorAll('.pin, .leg, .btn-leg').forEach(el => {
      el.removeAttribute('data-connected');
    });

    APP_STATE.wires.forEach(wire => {
      const comp = APP_STATE.components.find(c => c.id === wire.compId);
      const arduino = APP_STATE.components.find(c => c.type === 'arduino');
      if (!comp || !arduino) return;

      let termEl;
      if (comp.type === 'led') {
        termEl = comp.el.querySelector(`.leg[data-term="${wire.terminal}"]`);
      } else {
        termEl = comp.el.querySelector(`.btn-leg[data-term="${wire.terminal}"]`);
      }

      const pinEl = arduino.el.querySelector(`.pin[data-pin="${wire.pin}"]`);

      if (termEl && pinEl) {
        const termRect = termEl.getBoundingClientRect();
        const pinRect = pinEl.getBoundingClientRect();

        const x1 = termRect.left + termRect.width / 2 - canvasRect.left;
        const y1 = termRect.top + termRect.height / 2 - canvasRect.top;
        const x2 = pinRect.left + pinRect.width / 2 - canvasRect.left;
        const y2 = pinRect.top + pinRect.height / 2 - canvasRect.top;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${x1} ${y1} C ${x1} ${y1 + 50}, ${x2 - 20} ${y2}, ${x2} ${y2}`;

        path.setAttribute('d', d);
        path.setAttribute('stroke', 'var(--wire-color)');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('fill', 'none');

        wireLayer.appendChild(path);

        pinEl.setAttribute('data-connected', 'true');
        termEl.setAttribute('data-connected', 'true');
      }
    });
  }

  function generateCode() {
    const leds = APP_STATE.wires.filter(w => {
      const c = APP_STATE.components.find(x => x.id === w.compId);
      return c && c.type === 'led';
    }).map(w => w.pin).sort((a, b) => a - b);

    const btns = APP_STATE.wires.filter(w => {
      const c = APP_STATE.components.find(x => x.id === w.compId);
      return c && c.type === 'button';
    }).map(w => w.pin).sort((a, b) => a - b);

    let s = `// Generated Arduino Code\n\n`;

    if (leds.length === 1) {
      s += `int ledPin = ${leds[0]};\n`;
    } else if (leds.length > 1) {
      s += `int ledPins[] = { ${leds.join(', ')} };\n`;
      s += `int ledCount = ${leds.length};\n`;
    }

    if (btns.length === 1) {
      s += `int buttonPin = ${btns[0]};\n`;
    } else if (btns.length > 1) {
      s += `int buttonPins[] = { ${btns.join(', ')} };\n`;
      s += `int buttonCount = ${btns.length};\n`;
    }

    s += `\nvoid setup() {\n`;

    if (leds.length === 1) {
      s += `  pinMode(ledPin, OUTPUT);\n`;
    } else if (leds.length > 1) {
      s += `  for (int i = 0; i < ledCount; i++) {\n    pinMode(ledPins[i], OUTPUT);\n  }\n`;
    }

    if (btns.length === 1) {
      s += `  pinMode(buttonPin, INPUT);\n`;
    } else if (btns.length > 1) {
      s += `  for (int i = 0; i < buttonCount; i++) {\n    pinMode(buttonPins[i], INPUT);\n  }\n`;
    }

    s += `}\n\nvoid loop() {\n`;

    if (btns.length === 0) {
      s += `  // No input buttons designated.\n`;
    } else {
      if (btns.length === 1) {
        s += `  int state = digitalRead(buttonPin);\n`;
      } else {
        s += `  int state = 0;\n`;
        s += `  for (int i = 0; i < buttonCount; i++) {\n    if(digitalRead(buttonPins[i]) == HIGH) state = HIGH;\n  }\n`;
      }

      if (leds.length === 0) {
        s += `  // No output LEDs to drive.\n`;
      } else if (leds.length === 1) {
        s += `  digitalWrite(ledPin, state);\n`;
      } else {
        s += `  for (int i = 0; i < ledCount; i++) {\n    digitalWrite(ledPins[i], state);\n  }\n`;
      }
    }

    s += `}\n`;
    codeDisplay.textContent = s;
  }

  const pinStates = {};
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');

  btnStart.addEventListener('click', () => {
    isSimulationRunning = true;
    btnStart.style.opacity = '0.5';
    btnStop.style.opacity = '1';
    alert("Simulation Started. Press the Push Button to light up the LED.");
    updateSimulation();
  });

  btnStop.addEventListener('click', () => {
    isSimulationRunning = false;
    btnStart.style.opacity = '1';
    btnStop.style.opacity = '0.5';
    resetSimulation();
  });

  function updateSimulation() {
    if (!isSimulationRunning) return;

    ARDUINO_PINS.forEach(p => pinStates[p] = 0);

    let globalButtonState = 0;
    APP_STATE.components.filter(c => c.type === 'button').forEach(btn => {
      if (btn.isPressed) {
        const wire = APP_STATE.wires.find(w => w.compId === btn.id && w.terminal === 't1');
        if (wire) {
          pinStates[wire.pin] = 1;
          globalButtonState = 1;
        }
      }
    });

    APP_STATE.components.filter(c => c.type === 'led').forEach(led => {
      const wire = APP_STATE.wires.find(w => w.compId === led.id && w.terminal === 'anode');
      if (wire) {
        pinStates[wire.pin] = globalButtonState;
      }
    });

    APP_STATE.components.filter(c => c.type === 'led').forEach(led => {
      const wire = APP_STATE.wires.find(w => w.compId === led.id && w.terminal === 'anode');
      const bulb = led.el.querySelector('.led-bulb');
      if (wire && pinStates[wire.pin] === 1) {
        bulb.classList.add('on');
      } else {
        bulb.classList.remove('on');
      }
    });
  }

  function resetSimulation() {
    document.querySelectorAll('.led-bulb.on').forEach(el => el.classList.remove('on'));
    APP_STATE.components.forEach(c => c.isPressed = false);
  }

  canvas.addEventListener('mousedown', (e) => {
    if (!isSimulationRunning) return;
    if (e.target.classList.contains('btn-cap')) {
      const compEl = e.target.closest('.component');
      if (compEl) {
        const comp = APP_STATE.components.find(c => c.id == compEl.dataset.id);
        if (comp && comp.type === 'button') {
          comp.isPressed = true;
          e.target.style.transform = "scale(0.95)";
          updateSimulation();
          e.stopPropagation();
        }
      }
    }
  });

  document.addEventListener('mouseup', () => {
    if (!isSimulationRunning) return;
    APP_STATE.components.forEach(c => {
      if (c.type === 'button' && c.isPressed) {
        c.isPressed = false;
        const cap = c.el.querySelector('.btn-cap');
        if (cap) cap.style.transform = "scale(1)";
      }
    });
    updateSimulation();
  });

  init();

})();