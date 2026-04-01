import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, Settings, X, SlidersHorizontal, Play, Square, Activity, Music } from 'lucide-react';

class HarmoniumSynth {
  ctx: AudioContext;
  activeNodes: Map<string, { osc1: OscillatorNode, osc2: OscillatorNode, osc3: OscillatorNode, gainNode: GainNode }>;
  masterGain: GainNode;
  masterFilter: BiquadFilterNode;
  convolver: ConvolverNode;
  reverbGain: GainNode;
  chorusDelay: DelayNode;
  chorusLFO: OscillatorNode;
  chorusGain: GainNode;
  bellowsLFO: OscillatorNode | null = null;
  bellowsGain: GainNode;
  preset: string = 'classic';
  transpose: number = 0;
  couplerEnabled: boolean = false;
  fineTune: number = 440;
  chorusEnabled: boolean = false;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.activeNodes = new Map();
    
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.4;

    this.bellowsGain = this.ctx.createGain();
    this.bellowsGain.gain.value = 1.0;

    this.masterFilter = this.ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 3000;

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.2;

    this.convolver = this.ctx.createConvolver();
    this.generateImpulseResponse();

    // Chorus setup
    this.chorusDelay = this.ctx.createDelay();
    this.chorusDelay.delayTime.value = 0.03;
    this.chorusLFO = this.ctx.createOscillator();
    this.chorusLFO.frequency.value = 1.5;
    this.chorusGain = this.ctx.createGain();
    this.chorusGain.gain.value = 0.002;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.002;
    this.chorusLFO.connect(lfoGain);
    lfoGain.connect(this.chorusDelay.delayTime);
    this.chorusLFO.start();

    this.masterGain.connect(this.bellowsGain);
    this.bellowsGain.connect(this.masterFilter);
    
    // Chorus path
    this.masterFilter.connect(this.chorusDelay);
    this.chorusDelay.connect(this.ctx.destination);
    
    // Direct path
    this.masterFilter.connect(this.ctx.destination);
    
    // Reverb path
    this.masterGain.connect(this.convolver);
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.ctx.destination);

    this.startBellowsLFO();
    this.setChorus(false);
  }

  setChorus(enabled: boolean) {
    this.chorusEnabled = enabled;
    this.chorusDelay.delayTime.setTargetAtTime(enabled ? 0.03 : 0, this.ctx.currentTime, 0.1);
  }

  startBellowsLFO() {
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    
    lfo.type = 'sine';
    lfo.frequency.value = 2.5; // Slow bellows fluctuation
    lfoGain.gain.value = 0.05; // Subtle effect
    
    lfo.connect(lfoGain);
    lfoGain.connect(this.bellowsGain.gain);
    
    lfo.start();
    this.bellowsLFO = lfo;
  }

  generateImpulseResponse() {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 2.0;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
      const decay = Math.exp(-i / (sampleRate * 0.5));
      left[i] = (Math.random() * 2 - 1) * decay;
      right[i] = (Math.random() * 2 - 1) * decay;
    }
    this.convolver.buffer = impulse;
  }

  setVolume(val: number) {
    this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.05);
  }

  setFilterFreq(val: number) {
    this.masterFilter.frequency.setTargetAtTime(val, this.ctx.currentTime, 0.05);
  }

  setReverb(val: number) {
    this.reverbGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.05);
  }

  setPreset(preset: string) {
    this.preset = preset;
  }

  setTranspose(semitones: number) {
    this.transpose = semitones;
  }

  setCoupler(enabled: boolean) {
    this.couplerEnabled = enabled;
  }

  setFineTune(hz: number) {
    this.fineTune = hz;
  }

  playNote(note: string, baseFreq: number) {
    if (this.activeNodes.has(note)) return;

    // Use fineTune instead of hardcoded 440 ratio if needed, 
    // but here baseFreq is already calculated. We adjust it relative to 440.
    const freqRatio = this.fineTune / 440;
    const freq = baseFreq * freqRatio * Math.pow(2, this.transpose / 12);

    this.renderNote(note, freq);
    
    if (this.couplerEnabled) {
      this.renderNote(`${note}_coupler`, freq * 2);
    }
  }

  private renderNote(noteId: string, freq: number) {
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const osc3 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    let type1: OscillatorType = 'sawtooth';
    let type2: OscillatorType = 'square';
    let type3: OscillatorType = 'sawtooth';
    let detune2 = 1.003;
    let detune3 = 0.997;
    let filterMult = 5;

    if (this.preset === 'bright') {
      type1 = 'sawtooth'; type2 = 'sawtooth'; type3 = 'square';
      detune2 = 1.005; detune3 = 0.995;
      filterMult = 8;
    } else if (this.preset === 'mellow') {
      type1 = 'triangle'; type2 = 'sine'; type3 = 'triangle';
      detune2 = 1.002; detune3 = 0.998;
      filterMult = 3;
    } else if (this.preset === 'double') {
      type1 = 'sawtooth'; type2 = 'square'; type3 = 'sawtooth';
      detune2 = 0.5; // octave down
      detune3 = 1.004;
      filterMult = 6;
    }

    osc1.type = type1;
    osc2.type = type2;
    osc3.type = type3;

    osc1.frequency.value = freq;
    osc2.frequency.value = freq * detune2;
    osc3.frequency.value = freq * detune3;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * filterMult;
    filter.Q.value = 0.5;

    osc1.connect(filter);
    osc2.connect(filter);
    osc3.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.masterGain);

    gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.05);

    osc1.start();
    osc2.start();
    osc3.start();

    this.activeNodes.set(noteId, { osc1, osc2, osc3, gainNode });
  }

  stopNote(note: string) {
    this.releaseNote(note);
    if (this.couplerEnabled) {
      this.releaseNote(`${note}_coupler`);
    }
  }

  private releaseNote(noteId: string) {
    const nodes = this.activeNodes.get(noteId);
    if (!nodes) return;

    const { osc1, osc2, osc3, gainNode } = nodes;
    gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

    setTimeout(() => {
      try {
        osc1.stop();
        osc2.stop();
        osc3.stop();
        osc1.disconnect();
        osc2.disconnect();
        osc3.disconnect();
        gainNode.disconnect();
      } catch (e) {}
    }, 200);

    this.activeNodes.delete(noteId);
  }
}

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const generateKeys = () => {
  const keys = [];
  let whiteIndex = 0;
  // Standard Indian Harmonium: 39 keys (C2 to D5)
  // C2 is MIDI 36, D5 is MIDI 74
  for (let i = 36; i <= 74; i++) {
    const octave = Math.floor(i / 12) - 1;
    const noteName = noteNames[i % 12];
    const isWhite = !noteName.includes('#');
    const freq = 440 * Math.pow(2, (i - 69) / 12);
    
    const key: any = {
      note: `${noteName}${octave}`,
      freq: Number(freq.toFixed(2)),
      type: isWhite ? 'white' : 'black',
      label: noteName,
      keyBind: ''
    };
    
    if (isWhite) {
      key.whiteIndex = whiteIndex;
      whiteIndex++;
    } else {
      key.afterWhiteIndex = whiteIndex - 1;
    }
    
    keys.push(key);
  }
  
  // Assign keybinds to a middle section (C3 to G5)
  const keyBinds = [
    'z', 's', 'x', 'd', 'c', 'v', 'g', 'b', 'h', 'n', 'j', 'm',
    'q', '2', 'w', '3', 'e', 'r', '5', 't', '6', 'y', '7', 'u',
    'i', '9', 'o', '0', 'p', '[', '=', ']'
  ];
  
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].note === 'C3') {
      for (let j = 0; j < keyBinds.length && (i + j) < keys.length; j++) {
        keys[i + j].keyBind = keyBinds[j];
      }
      break;
    }
  }
  return keys;
};

const KEYS = generateKeys();

const DRONES = [
  { note: 'C3', freq: 130.81, keyBind: '1', label: 'Drone Sa' },
  { note: 'G3', freq: 196.00, keyBind: '4', label: 'Drone Pa' },
  { note: 'C4', freq: 261.63, keyBind: '8', label: 'Drone Sa^' },
];

const SONGS: Record<string, {n: string, f: number, t: number, d: number}[]> = {
  'scale': [
    { n: 'C4', f: 261.63, t: 0, d: 300 }, { n: 'D4', f: 293.66, t: 400, d: 300 },
    { n: 'E4', f: 329.63, t: 800, d: 300 }, { n: 'F4', f: 349.23, t: 1200, d: 300 },
    { n: 'G4', f: 392.00, t: 1600, d: 300 }, { n: 'A4', f: 440.00, t: 2000, d: 300 },
    { n: 'B4', f: 493.88, t: 2400, d: 300 }, { n: 'C5', f: 523.25, t: 2800, d: 300 }
  ],
  'twinkle': [
    { n: 'C4', f: 261.63, t: 0, d: 400 }, { n: 'C4', f: 261.63, t: 500, d: 400 },
    { n: 'G4', f: 392.00, t: 1000, d: 400 }, { n: 'G4', f: 392.00, t: 1500, d: 400 },
    { n: 'A4', f: 440.00, t: 2000, d: 400 }, { n: 'A4', f: 440.00, t: 2500, d: 400 },
    { n: 'G4', f: 392.00, t: 3000, d: 800 },
    { n: 'F4', f: 349.23, t: 4000, d: 400 }, { n: 'F4', f: 349.23, t: 4500, d: 400 },
    { n: 'E4', f: 329.63, t: 5000, d: 400 }, { n: 'E4', f: 329.63, t: 5500, d: 400 },
    { n: 'D4', f: 293.66, t: 6000, d: 400 }, { n: 'D4', f: 293.66, t: 6500, d: 400 },
    { n: 'C4', f: 261.63, t: 7000, d: 800 }
  ],
  'fur_elise': [
    { n: 'E5', f: 659.25, t: 0, d: 200 }, { n: 'D#5', f: 622.25, t: 250, d: 200 },
    { n: 'E5', f: 659.25, t: 500, d: 200 }, { n: 'D#5', f: 622.25, t: 750, d: 200 },
    { n: 'E5', f: 659.25, t: 1000, d: 200 }, { n: 'B4', f: 493.88, t: 1250, d: 200 },
    { n: 'D5', f: 587.33, t: 1500, d: 200 }, { n: 'C5', f: 523.25, t: 1750, d: 200 },
    { n: 'A4', f: 440.00, t: 2000, d: 400 }
  ],
  'canon_in_d': [
    { n: 'F#4', f: 369.99, t: 0, d: 400 }, { n: 'E4', f: 329.63, t: 400, d: 400 },
    { n: 'D4', f: 293.66, t: 800, d: 400 }, { n: 'C#4', f: 277.18, t: 1200, d: 400 },
    { n: 'B3', f: 246.94, t: 1600, d: 400 }, { n: 'A3', f: 220.00, t: 2000, d: 400 },
    { n: 'B3', f: 246.94, t: 2400, d: 400 }, { n: 'C#4', f: 277.18, t: 2800, d: 400 }
  ],
  'ode_to_joy': [
    { n: 'E4', f: 329.63, t: 0, d: 400 }, { n: 'E4', f: 329.63, t: 400, d: 400 }, { n: 'F4', f: 349.23, t: 800, d: 400 }, { n: 'G4', f: 392.00, t: 1200, d: 400 },
    { n: 'G4', f: 392.00, t: 1600, d: 400 }, { n: 'F4', f: 349.23, t: 2000, d: 400 }, { n: 'E4', f: 329.63, t: 2400, d: 400 }, { n: 'D4', f: 293.66, t: 2800, d: 400 },
    { n: 'C4', f: 261.63, t: 3200, d: 400 }, { n: 'C4', f: 261.63, t: 3600, d: 400 }, { n: 'D4', f: 293.66, t: 4000, d: 400 }, { n: 'E4', f: 329.63, t: 4400, d: 400 },
    { n: 'E4', f: 329.63, t: 4800, d: 600 }, { n: 'D4', f: 293.66, t: 5400, d: 200 }, { n: 'D4', f: 293.66, t: 5600, d: 800 }
  ],
  'happy_birthday': [
    { n: 'G4', f: 392.00, t: 0, d: 300 }, { n: 'G4', f: 392.00, t: 300, d: 100 }, { n: 'A4', f: 440.00, t: 400, d: 400 }, { n: 'G4', f: 392.00, t: 800, d: 400 },
    { n: 'C5', f: 523.25, t: 1200, d: 400 }, { n: 'B4', f: 493.88, t: 1600, d: 800 },
    { n: 'G4', f: 392.00, t: 2400, d: 300 }, { n: 'G4', f: 392.00, t: 2700, d: 100 }, { n: 'A4', f: 440.00, t: 2800, d: 400 }, { n: 'G4', f: 392.00, t: 3200, d: 400 },
    { n: 'D5', f: 587.33, t: 3600, d: 400 }, { n: 'C5', f: 523.25, t: 4000, d: 800 }
  ],
  'jingle_bells': [
    { n: 'E4', f: 329.63, t: 0, d: 200 }, { n: 'E4', f: 329.63, t: 200, d: 200 }, { n: 'E4', f: 329.63, t: 400, d: 400 },
    { n: 'E4', f: 329.63, t: 800, d: 200 }, { n: 'E4', f: 329.63, t: 1000, d: 200 }, { n: 'E4', f: 329.63, t: 1200, d: 400 },
    { n: 'E4', f: 329.63, t: 1600, d: 200 }, { n: 'G4', f: 392.00, t: 1800, d: 200 }, { n: 'C4', f: 261.63, t: 2000, d: 300 }, { n: 'D4', f: 293.66, t: 2300, d: 100 },
    { n: 'E4', f: 329.63, t: 2400, d: 800 }
  ],
  'raga_yaman': [
    { n: 'B3', f: 246.94, t: 0, d: 400 }, { n: 'D4', f: 293.66, t: 400, d: 400 }, { n: 'E4', f: 329.63, t: 800, d: 400 },
    { n: 'F#4', f: 369.99, t: 1200, d: 400 }, { n: 'A4', f: 440.00, t: 1600, d: 400 }, { n: 'B4', f: 493.88, t: 2000, d: 400 },
    { n: 'C5', f: 523.25, t: 2400, d: 800 },
    { n: 'C5', f: 523.25, t: 3600, d: 400 }, { n: 'B4', f: 493.88, t: 4000, d: 400 }, { n: 'A4', f: 440.00, t: 4400, d: 400 },
    { n: 'G4', f: 392.00, t: 4800, d: 400 }, { n: 'F#4', f: 369.99, t: 5200, d: 400 }, { n: 'E4', f: 329.63, t: 5600, d: 400 },
    { n: 'D4', f: 293.66, t: 6000, d: 400 }, { n: 'C4', f: 261.63, t: 6400, d: 800 },
    // Pakad: N R G, R G, P M G, R S
    { n: 'B3', f: 246.94, t: 7600, d: 400 }, { n: 'D4', f: 293.66, t: 8000, d: 400 }, { n: 'E4', f: 329.63, t: 8400, d: 800 },
    { n: 'D4', f: 293.66, t: 9600, d: 400 }, { n: 'E4', f: 329.63, t: 10000, d: 800 },
    { n: 'G4', f: 392.00, t: 11200, d: 400 }, { n: 'F#4', f: 369.99, t: 11600, d: 400 }, { n: 'E4', f: 329.63, t: 12000, d: 800 },
    { n: 'D4', f: 293.66, t: 13200, d: 400 }, { n: 'C4', f: 261.63, t: 13600, d: 800 }
  ],
  'raga_bhairav': [
    { n: 'C4', f: 261.63, t: 0, d: 400 }, { n: 'C#4', f: 277.18, t: 400, d: 400 }, { n: 'E4', f: 329.63, t: 800, d: 400 },
    { n: 'F4', f: 349.23, t: 1200, d: 400 }, { n: 'G4', f: 392.00, t: 1600, d: 400 }, { n: 'G#4', f: 415.30, t: 2000, d: 400 },
    { n: 'B4', f: 493.88, t: 2400, d: 400 }, { n: 'C5', f: 523.25, t: 2800, d: 800 },
    { n: 'C5', f: 523.25, t: 4000, d: 400 }, { n: 'B4', f: 493.88, t: 4400, d: 400 }, { n: 'G#4', f: 415.30, t: 4800, d: 400 },
    { n: 'G4', f: 392.00, t: 5200, d: 400 }, { n: 'F4', f: 349.23, t: 5600, d: 400 }, { n: 'E4', f: 329.63, t: 6000, d: 400 },
    { n: 'C#4', f: 277.18, t: 6400, d: 400 }, { n: 'C4', f: 261.63, t: 6800, d: 800 },
    // Pakad: G M d P, G M r S
    { n: 'E4', f: 329.63, t: 8000, d: 400 }, { n: 'F4', f: 349.23, t: 8400, d: 400 }, { n: 'G#4', f: 415.30, t: 8800, d: 400 }, { n: 'G4', f: 392.00, t: 9200, d: 800 },
    { n: 'E4', f: 329.63, t: 10400, d: 400 }, { n: 'F4', f: 349.23, t: 10800, d: 400 }, { n: 'C#4', f: 277.18, t: 11200, d: 400 }, { n: 'C4', f: 261.63, t: 11600, d: 800 }
  ],
  'raga_hansadhwani': [
    { n: 'C4', f: 261.63, t: 0, d: 400 }, { n: 'D4', f: 293.66, t: 400, d: 400 }, { n: 'E4', f: 329.63, t: 800, d: 400 },
    { n: 'G4', f: 392.00, t: 1200, d: 400 }, { n: 'B4', f: 493.88, t: 1600, d: 400 }, { n: 'C5', f: 523.25, t: 2000, d: 800 },
    { n: 'C5', f: 523.25, t: 3200, d: 400 }, { n: 'B4', f: 493.88, t: 3600, d: 400 }, { n: 'G4', f: 392.00, t: 4000, d: 400 },
    { n: 'E4', f: 329.63, t: 4400, d: 400 }, { n: 'D4', f: 293.66, t: 4800, d: 400 }, { n: 'C4', f: 261.63, t: 5200, d: 800 },
    // Characteristic phrase
    { n: 'G4', f: 392.00, t: 6400, d: 400 }, { n: 'B4', f: 493.88, t: 6800, d: 400 }, { n: 'C5', f: 523.25, t: 7200, d: 800 },
    { n: 'B4', f: 493.88, t: 8400, d: 400 }, { n: 'G4', f: 392.00, t: 8800, d: 400 }, { n: 'E4', f: 329.63, t: 9200, d: 400 }, { n: 'D4', f: 293.66, t: 9600, d: 400 }, { n: 'C4', f: 261.63, t: 10000, d: 800 }
  ],
  'jana_gana_mana': [
    { n: 'C4', f: 261.63, t: 0, d: 300 }, { n: 'D4', f: 293.66, t: 400, d: 300 }, { n: 'E4', f: 329.63, t: 800, d: 300 }, { n: 'E4', f: 329.63, t: 1200, d: 300 },
    { n: 'E4', f: 329.63, t: 1600, d: 300 }, { n: 'E4', f: 329.63, t: 2000, d: 300 }, { n: 'E4', f: 329.63, t: 2400, d: 300 }, { n: 'E4', f: 329.63, t: 2800, d: 300 },
    { n: 'E4', f: 329.63, t: 3200, d: 300 }, { n: 'D4', f: 293.66, t: 3600, d: 300 }, { n: 'E4', f: 329.63, t: 4000, d: 300 }, { n: 'F4', f: 349.23, t: 4400, d: 600 },
    { n: 'E4', f: 329.63, t: 5200, d: 300 }, { n: 'E4', f: 329.63, t: 5600, d: 300 }, { n: 'E4', f: 329.63, t: 6000, d: 300 }, { n: 'D4', f: 293.66, t: 6400, d: 300 },
    { n: 'D4', f: 293.66, t: 6800, d: 300 }, { n: 'D4', f: 293.66, t: 7200, d: 300 }, { n: 'B3', f: 246.94, t: 7600, d: 300 }, { n: 'D4', f: 293.66, t: 8000, d: 300 }, { n: 'C4', f: 261.63, t: 8400, d: 600 },
    // Punjab Sindhu Gujarat Maratha...
    { n: 'G4', f: 392.00, t: 9200, d: 300 }, { n: 'G4', f: 392.00, t: 9600, d: 300 }, { n: 'G4', f: 392.00, t: 10000, d: 300 }, { n: 'G4', f: 392.00, t: 10400, d: 300 },
    { n: 'G4', f: 392.00, t: 10800, d: 300 }, { n: 'G4', f: 392.00, t: 11200, d: 300 }, { n: 'F#4', f: 369.99, t: 11600, d: 300 }, { n: 'A4', f: 440.00, t: 12000, d: 300 }, { n: 'G4', f: 392.00, t: 12400, d: 600 },
    { n: 'F4', f: 349.23, t: 13200, d: 300 }, { n: 'F4', f: 349.23, t: 13600, d: 300 }, { n: 'F4', f: 349.23, t: 14000, d: 300 }, { n: 'E4', f: 329.63, t: 14400, d: 300 },
    { n: 'D4', f: 293.66, t: 14800, d: 300 }, { n: 'F4', f: 349.23, t: 15200, d: 300 }, { n: 'E4', f: 329.63, t: 15600, d: 600 },
    // Tava shubha name jage...
    { n: 'E4', f: 329.63, t: 16400, d: 300 }, { n: 'F4', f: 349.23, t: 16800, d: 300 }, { n: 'G4', f: 392.00, t: 17200, d: 300 }, { n: 'G4', f: 392.00, t: 17600, d: 300 },
    { n: 'F4', f: 349.23, t: 18000, d: 300 }, { n: 'E4', f: 329.63, t: 18400, d: 300 }, { n: 'D4', f: 293.66, t: 18800, d: 300 }, { n: 'F4', f: 349.23, t: 19200, d: 300 }, { n: 'E4', f: 329.63, t: 19600, d: 600 },
    // Tava shubha ashisha mage...
    { n: 'E4', f: 329.63, t: 20400, d: 300 }, { n: 'F4', f: 349.23, t: 20800, d: 300 }, { n: 'G4', f: 392.00, t: 21200, d: 300 }, { n: 'G4', f: 392.00, t: 21600, d: 300 },
    { n: 'F4', f: 349.23, t: 22000, d: 300 }, { n: 'E4', f: 329.63, t: 22400, d: 300 }, { n: 'D4', f: 293.66, t: 22800, d: 300 }, { n: 'F4', f: 349.23, t: 23200, d: 300 }, { n: 'E4', f: 329.63, t: 23600, d: 600 },
    // Gahe tava jaya gatha...
    { n: 'E4', f: 329.63, t: 24400, d: 300 }, { n: 'E4', f: 329.63, t: 24800, d: 300 }, { n: 'D4', f: 293.66, t: 25200, d: 300 }, { n: 'G4', f: 392.00, t: 25600, d: 300 },
    { n: 'G4', f: 392.00, t: 26000, d: 300 }, { n: 'F4', f: 349.23, t: 26400, d: 300 }, { n: 'F4', f: 349.23, t: 26800, d: 300 }, { n: 'E4', f: 329.63, t: 27200, d: 600 },
    // Jana gana mangala dayaka jaya he...
    { n: 'C4', f: 261.63, t: 28000, d: 300 }, { n: 'D4', f: 293.66, t: 28400, d: 300 }, { n: 'E4', f: 329.63, t: 28800, d: 300 }, { n: 'E4', f: 329.63, t: 29200, d: 300 },
    { n: 'E4', f: 329.63, t: 29600, d: 300 }, { n: 'D4', f: 293.66, t: 30000, d: 300 }, { n: 'F4', f: 349.23, t: 30400, d: 300 }, { n: 'E4', f: 329.63, t: 30800, d: 600 },
    // Bharata bhagya vidhata...
    { n: 'D4', f: 293.66, t: 31600, d: 300 }, { n: 'D4', f: 293.66, t: 32000, d: 300 }, { n: 'D4', f: 293.66, t: 32400, d: 300 }, { n: 'B3', f: 246.94, t: 32800, d: 300 },
    { n: 'D4', f: 293.66, t: 33200, d: 300 }, { n: 'C4', f: 261.63, t: 33600, d: 600 },
    // Jaya he, jaya he, jaya he...
    { n: 'B4', f: 493.88, t: 34400, d: 400 }, { n: 'C5', f: 523.25, t: 34800, d: 400 }, { n: 'B4', f: 493.88, t: 35200, d: 400 }, { n: 'A4', f: 440.00, t: 35600, d: 400 },
    { n: 'B4', f: 493.88, t: 36000, d: 400 }, { n: 'A4', f: 440.00, t: 36400, d: 400 }, { n: 'G4', f: 392.00, t: 36800, d: 400 }, { n: 'A4', f: 440.00, t: 37200, d: 400 },
    // Jaya jaya jaya jaya he!
    { n: 'C4', f: 261.63, t: 38000, d: 200 }, { n: 'D4', f: 293.66, t: 38200, d: 200 }, { n: 'E4', f: 329.63, t: 38400, d: 200 }, { n: 'F4', f: 349.23, t: 38600, d: 200 },
    { n: 'G4', f: 392.00, t: 38800, d: 800 }
  ],
  'vaishnav_jan_to': [
    { n: 'C4', f: 261.63, t: 0, d: 400 }, { n: 'F4', f: 349.23, t: 500, d: 400 }, { n: 'E4', f: 329.63, t: 1000, d: 400 }, { n: 'F4', f: 349.23, t: 1500, d: 400 },
    { n: 'G4', f: 392.00, t: 2000, d: 400 }, { n: 'G4', f: 392.00, t: 2500, d: 400 }, { n: 'A4', f: 440.00, t: 3000, d: 400 }, { n: 'G4', f: 392.00, t: 3500, d: 400 },
    { n: 'F4', f: 349.23, t: 4000, d: 400 }, { n: 'E4', f: 329.63, t: 4500, d: 400 }, { n: 'D4', f: 293.66, t: 5000, d: 400 }, { n: 'C4', f: 261.63, t: 5500, d: 800 },
    // Par-dukkhe upkar kare toye...
    { n: 'C4', f: 261.63, t: 6500, d: 400 }, { n: 'D4', f: 293.66, t: 7000, d: 400 }, { n: 'E4', f: 329.63, t: 7500, d: 400 }, { n: 'F4', f: 349.23, t: 8000, d: 400 },
    { n: 'G4', f: 392.00, t: 8500, d: 400 }, { n: 'A4', f: 440.00, t: 9000, d: 400 }, { n: 'B4', f: 493.88, t: 9500, d: 400 }, { n: 'C5', f: 523.25, t: 10000, d: 800 },
    // Sakal lok ma sahune vande...
    { n: 'C5', f: 523.25, t: 11000, d: 400 }, { n: 'B4', f: 493.88, t: 11500, d: 400 }, { n: 'A4', f: 440.00, t: 12000, d: 400 }, { n: 'G4', f: 392.00, t: 12500, d: 400 },
    { n: 'F4', f: 349.23, t: 13000, d: 400 }, { n: 'E4', f: 329.63, t: 13500, d: 400 }, { n: 'D4', f: 293.66, t: 14000, d: 400 }, { n: 'C4', f: 261.63, t: 14500, d: 800 },
    // Ninda na kare keni re...
    { n: 'C4', f: 261.63, t: 15500, d: 400 }, { n: 'F4', f: 349.23, t: 16000, d: 400 }, { n: 'G4', f: 392.00, t: 16500, d: 400 }, { n: 'A4', f: 440.00, t: 17000, d: 400 },
    { n: 'G4', f: 392.00, t: 17500, d: 400 }, { n: 'F4', f: 349.23, t: 18000, d: 400 }, { n: 'E4', f: 329.63, t: 18500, d: 400 }, { n: 'C4', f: 261.63, t: 19000, d: 800 }
  ],
  'lollipop_lagelu': [
    { n: 'G4', f: 392.00, t: 0, d: 200 }, { n: 'G4', f: 392.00, t: 250, d: 200 }, { n: 'G4', f: 392.00, t: 500, d: 200 }, { n: 'A4', f: 440.00, t: 750, d: 200 },
    { n: 'G4', f: 392.00, t: 1000, d: 200 }, { n: 'F4', f: 349.23, t: 1250, d: 200 }, { n: 'E4', f: 329.63, t: 1500, d: 200 }, { n: 'D4', f: 293.66, t: 1750, d: 400 },
    { n: 'C4', f: 261.63, t: 2200, d: 400 }, { n: 'E4', f: 329.63, t: 2700, d: 200 }, { n: 'G4', f: 392.00, t: 3000, d: 400 },
    // Kamariya kare lapa lap...
    { n: 'C5', f: 523.25, t: 3500, d: 200 }, { n: 'C5', f: 523.25, t: 3750, d: 200 }, { n: 'B4', f: 493.88, t: 4000, d: 200 }, { n: 'A4', f: 440.00, t: 4250, d: 200 },
    { n: 'G4', f: 392.00, t: 4500, d: 400 }, { n: 'F4', f: 349.23, t: 5000, d: 400 }, { n: 'G4', f: 392.00, t: 5500, d: 400 },
    // Jab lagawelu tu lipistick...
    { n: 'G4', f: 392.00, t: 6000, d: 200 }, { n: 'A4', f: 440.00, t: 6250, d: 200 }, { n: 'C5', f: 523.25, t: 6500, d: 400 }, { n: 'D5', f: 587.33, t: 7000, d: 400 },
    { n: 'C5', f: 523.25, t: 7500, d: 400 }, { n: 'B4', f: 493.88, t: 8000, d: 400 }, { n: 'A4', f: 440.00, t: 8500, d: 400 },
    // Hilela ara jila...
    { n: 'G4', f: 392.00, t: 9000, d: 200 }, { n: 'G4', f: 392.00, t: 9250, d: 200 }, { n: 'G4', f: 392.00, t: 9500, d: 200 }, { n: 'A4', f: 440.00, t: 9750, d: 200 },
    { n: 'G4', f: 392.00, t: 10000, d: 200 }, { n: 'F4', f: 349.23, t: 10250, d: 200 }, { n: 'E4', f: 329.63, t: 10500, d: 200 }, { n: 'D4', f: 293.66, t: 10750, d: 400 },
    { n: 'C4', f: 261.63, t: 11200, d: 400 }, { n: 'E4', f: 329.63, t: 11700, d: 200 }, { n: 'G4', f: 392.00, t: 12000, d: 400 }
  ]
};

export default function App() {
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const activeNotesRef = useRef<Set<string>>(new Set());
  const [activeDrones, setActiveDrones] = useState<Set<string>>(new Set());
  const audioEngine = useRef<HarmoniumSynth | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [showVisualizer, setShowVisualizer] = useState(true);
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiError, setMidiError] = useState<string | null>(null);
  
  // Demo & Practice Mode State
  const [isPlayingDemo, setIsPlayingDemo] = useState(false);
  const [isPracticeMode, setIsPracticeMode] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [selectedSong, setSelectedSong] = useState('scale');
  const [score, setScore] = useState({ hits: 0, misses: 0, streak: 0, maxStreak: 0 });

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordedNotes, setRecordedNotes] = useState<{n: string, f: number, t: number, d: number}[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const activeRecordingNotesRef = useRef<Map<string, number>>(new Map());
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<any[]>([]);
  const fallingNotesRef = useRef<any[]>([]);
  const scheduledNotesRef = useRef<any[]>([]);
  const demoStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

  const [filterFreq, setFilterFreq] = useState(3000);
  const [reverb, setReverb] = useState(0.2);
  const [preset, setPreset] = useState('classic');
  const [transpose, setTranspose] = useState(0);
  const [couplerEnabled, setCouplerEnabled] = useState(false);
  const [fineTune, setFineTune] = useState(440);
  const [chorusEnabled, setChorusEnabled] = useState(false);

  useEffect(() => {
    activeNotesRef.current = activeNotes;
  }, [activeNotes]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);

  const spawnVisuals = useCallback((note: string, isHit: boolean = false) => {
    if (!showVisualizer || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let x = Math.random() * canvas.width;
    const keyObj = KEYS.find(k => k.note === note);
    if (keyObj) {
      const isWhite = keyObj.type === 'white';
      const index = isWhite ? keyObj.whiteIndex : keyObj.afterWhiteIndex! + 0.5;
      const totalWhiteKeys = KEYS.filter(k => k.type === 'white').length;
      x = (index / totalWhiteKeys) * canvas.width + (canvas.width / (totalWhiteKeys * 2));
    }
    
    const color = isHit ? 'rgba(34, 197, 94, 1)' : 'rgba(251, 191, 36, 1)'; // Green for hit, Amber for normal
    
    // Ripple
    particlesRef.current.push({
      x, y: canvas.height,
      vx: 0, vy: 0,
      life: 1, size: 0,
      color,
      isRipple: true
    });

    for(let i=0; i<12; i++) {
      particlesRef.current.push({
        x, y: canvas.height,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 1) * 8,
        life: 1, size: Math.random() * 6 + 2,
        color,
        isRipple: false
      });
    }
  }, [showVisualizer]);

  useEffect(() => {
    if (midiEnabled && navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(access => {
        const handleMidi = (msg: any) => {
          const [cmd, note, vel] = msg.data;
          const freq = 440 * Math.pow(2, (note - 69) / 12);
          const noteId = `MIDI_${note}`;
          if (cmd === 144 && vel > 0) {
            if (!audioEngine.current) initAudio();
            audioEngine.current?.playNote(noteId, freq);
            setActiveNotes(prev => new Set(prev).add(noteId));
            spawnVisuals(noteId);
          } else if (cmd === 128 || (cmd === 144 && vel === 0)) {
            audioEngine.current?.stopNote(noteId);
            setActiveNotes(prev => {
              const next = new Set(prev);
              next.delete(noteId);
              return next;
            });
          }
        };
        access.inputs.forEach(input => {
          input.onmidimessage = handleMidi;
        });
        setMidiError(null);
      }).catch(err => {
        console.warn("MIDI access denied or not supported:", err);
        setMidiEnabled(false);
        setMidiError("MIDI access denied. Please allow permissions or use a supported browser.");
      });
    } else if (!midiEnabled) {
      setMidiError(null);
    }
  }, [midiEnabled, spawnVisuals]);

  useEffect(() => {
    if (!showVisualizer || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    let animationId: number;
    const render = () => {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      
      ctx.fillStyle = 'rgba(245, 158, 11, 0.6)';
      fallingNotesRef.current.forEach((note, i) => {
        note.y += 3;
        ctx.fillRect(note.x, note.y, note.width, note.height);
        if (note.y > ctx.canvas.height) fallingNotesRef.current.splice(i, 1);
      });

      particlesRef.current.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        ctx.fillStyle = `rgba(251, 191, 36, ${p.life})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        if (p.life <= 0) particlesRef.current.splice(i, 1);
      });
      
      animationId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationId);
  }, [showVisualizer]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setFilterFreq(filterFreq);
    }
  }, [filterFreq]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setReverb(reverb);
    }
  }, [reverb]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setPreset(preset);
    }
  }, [preset]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setTranspose(transpose);
    }
  }, [transpose]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setCoupler(couplerEnabled);
    }
  }, [couplerEnabled]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setFineTune(fineTune);
    }
  }, [fineTune]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setChorus(chorusEnabled);
    }
  }, [chorusEnabled]);

  const initAudio = () => {
    if (!audioEngine.current) {
      audioEngine.current = new HarmoniumSynth();
    }
    if (audioEngine.current.ctx.state === 'suspended') {
      audioEngine.current.ctx.resume();
    }
    setIsReady(true);
  };

  const toggleMute = () => {
    if (audioEngine.current) {
      const newMuted = !isMuted;
      audioEngine.current.masterGain.gain.value = newMuted ? 0 : 0.4;
      setIsMuted(newMuted);
    }
  };

  const playNote = useCallback((note: string, freq: number, isAutoPlay: boolean = false) => {
    if (!audioEngine.current) initAudio();
    
    // Practice mode logic
    if (isPlayingDemo && isPracticeMode && !isAutoPlay) {
      const now = performance.now() - demoStartTimeRef.current;
      const hitWindow = 300; // ms
      
      const targetNote = scheduledNotesRef.current.find(n => 
        n.n === note && 
        !n.hit && !n.missed &&
        Math.abs(n.t - now) < hitWindow
      );

      if (targetNote) {
        targetNote.hit = true;
        setScore(s => {
          const newStreak = s.streak + 1;
          return { ...s, hits: s.hits + 1, streak: newStreak, maxStreak: Math.max(s.maxStreak, newStreak) };
        });
        spawnVisuals(note, true);
      } else {
        setScore(s => ({ ...s, streak: 0 }));
        spawnVisuals(note, false);
      }
    } else if (!isAutoPlay) {
      spawnVisuals(note, false);
    }

    audioEngine.current?.playNote(note, freq);
    setActiveNotes(prev => new Set(prev).add(note));

    if (isRecording && !isAutoPlay) {
      activeRecordingNotesRef.current.set(note, performance.now() - recordingStartTimeRef.current);
    }
  }, [spawnVisuals, isPlayingDemo, isPracticeMode, isRecording]);

  const stopNote = useCallback((note: string) => {
    audioEngine.current?.stopNote(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });

    if (isRecording) {
      const startTime = activeRecordingNotesRef.current.get(note);
      if (startTime !== undefined) {
        const duration = performance.now() - recordingStartTimeRef.current - startTime;
        setRecordedNotes(prev => [...prev, { n: note, f: KEYS.find(k => k.note === note)?.freq || 0, t: startTime, d: duration }]);
        activeRecordingNotesRef.current.delete(note);
      }
    }
  }, [isRecording]);

  const toggleDrone = useCallback((note: string, freq: number) => {
    if (!audioEngine.current) initAudio();
    setActiveDrones(prev => {
      const next = new Set(prev);
      if (next.has(note)) {
        audioEngine.current?.stopNote(note);
        next.delete(note);
      } else {
        audioEngine.current?.playNote(note, freq);
        next.add(note);
      }
      return next;
    });
  }, []);

  const toggleDemo = () => {
    if (isPlayingDemo) {
      setIsPlayingDemo(false);
      cancelAnimationFrame(animationFrameRef.current);
      scheduledNotesRef.current = [];
      return;
    }
    
    setIsPlayingDemo(true);
    setScore({ hits: 0, misses: 0, streak: 0, maxStreak: 0 });
    initAudio();
    
    const song = selectedSong === 'recording' ? recordedNotes : SONGS[selectedSong];
    scheduledNotesRef.current = song.map(n => ({
      ...n,
      t: n.t / playbackSpeed,
      d: n.d / playbackSpeed,
      hit: false,
      missed: false,
      played: false,
      stopped: false
    }));
    
    demoStartTimeRef.current = performance.now() + 2000; // 2 seconds delay for first notes to fall
  };

  const toggleRecord = () => {
    if (isRecording) {
      setIsRecording(false);
      // Stop all active recording notes
      const now = performance.now() - recordingStartTimeRef.current;
      activeRecordingNotesRef.current.forEach((startTime, note) => {
        const duration = now - startTime;
        setRecordedNotes(prev => [...prev, { n: note, f: KEYS.find(k => k.note === note)?.freq || 0, t: startTime, d: duration }]);
      });
      activeRecordingNotesRef.current.clear();
    } else {
      setRecordedNotes([]);
      setIsRecording(true);
      recordingStartTimeRef.current = performance.now();
    }
  };

  const playRecording = () => {
    if (recordedNotes.length === 0 || isPlayingDemo) return;
    
    setIsPlayingDemo(true);
    setScore({ hits: 0, misses: 0, streak: 0, maxStreak: 0 });
    initAudio();
    
    scheduledNotesRef.current = recordedNotes.map(n => ({
      ...n,
      hit: false,
      missed: false,
      played: false,
      stopped: false
    }));
    
    demoStartTimeRef.current = performance.now() + 2000;
  };

  useEffect(() => {
    if (!showVisualizer || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const FALL_DURATION = 2000; // ms for a note to fall from top to bottom
    
    const render = (time: number) => {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      
      // Draw falling notes
      if (isPlayingDemo) {
        const elapsed = time - demoStartTimeRef.current;
        let allDone = true;

        scheduledNotesRef.current.forEach(note => {
          if (note.missed || note.hit) {
             // Note is done falling
          } else {
             allDone = false;
             const timeUntilHit = note.t - elapsed;
             const y = ctx.canvas.height - (timeUntilHit / FALL_DURATION) * ctx.canvas.height;
             const height = (note.d / FALL_DURATION) * ctx.canvas.height;
             
             if (y > -height && y < ctx.canvas.height + height) {
               const keyObj = KEYS.find(k => k.note === note.n);
               if (keyObj) {
                 const isWhite = keyObj.type === 'white';
                 const index = isWhite ? keyObj.whiteIndex : keyObj.afterWhiteIndex! + 0.5;
                 const totalWhiteKeys = KEYS.filter(k => k.type === 'white').length;
                 const keyWidth = ctx.canvas.width / totalWhiteKeys;
                 const x = (index / totalWhiteKeys) * ctx.canvas.width + (keyWidth / 2) - (keyWidth * 0.8 / 2);
                 const noteWidth = keyWidth * 0.8;
                 
                 // Draw 3D-like note block
                 const gradient = ctx.createLinearGradient(x, y - height, x + noteWidth, y);
                 gradient.addColorStop(0, 'rgba(245, 158, 11, 0.2)');
                 gradient.addColorStop(1, 'rgba(245, 158, 11, 0.9)');
                 
                 ctx.fillStyle = gradient;
                 ctx.shadowColor = 'rgba(245, 158, 11, 0.8)';
                 ctx.shadowBlur = 15;
                 ctx.fillRect(x, y - height, noteWidth, height);
                 ctx.shadowBlur = 0;
                 
                 // Highlight border
                 ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                 ctx.lineWidth = 2;
                 ctx.strokeRect(x, y - height, noteWidth, height);
               }
             }

             // Auto-play logic
             if (!isPracticeMode && !note.played && elapsed >= note.t) {
                playNote(note.n, note.f, true);
                note.played = true;
             }
             if (!isPracticeMode && note.played && !note.stopped && elapsed >= note.t + note.d) {
                stopNote(note.n);
                note.stopped = true;
             }

             // Practice mode miss logic
             if (isPracticeMode && !note.hit && elapsed > note.t + 300) {
                note.missed = true;
                setScore(s => ({ ...s, misses: s.misses + 1, streak: 0 }));
             }
          }
        });

        if (allDone && elapsed > scheduledNotesRef.current[scheduledNotesRef.current.length - 1].t + 1000) {
           if (isLooping) {
              toggleDemo(); // Stop
              setTimeout(toggleDemo, 100); // Restart
           } else {
              setIsPlayingDemo(false);
           }
        }
      }

      // Draw particles
      particlesRef.current.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        
        // Ripple effect
        if (p.isRipple) {
           ctx.strokeStyle = p.color.replace('1)', `${p.life})`);
           ctx.lineWidth = 2;
           ctx.beginPath();
           ctx.arc(p.x, p.y, (1 - p.life) * 50, 0, Math.PI * 2);
           ctx.stroke();
        } else {
           ctx.fillStyle = p.color.replace('1)', `${p.life})`);
           ctx.shadowColor = p.color;
           ctx.shadowBlur = 10;
           ctx.beginPath();
           ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
           ctx.fill();
           ctx.shadowBlur = 0;
        }
        
        if (p.life <= 0) particlesRef.current.splice(i, 1);
      });

      // Draw spotlights for active notes
      Array.from(activeNotesRef.current).forEach(note => {
        const keyObj = KEYS.find(k => k.note === note);
        if (keyObj) {
          const isWhite = keyObj.type === 'white';
          const index = isWhite ? keyObj.whiteIndex : keyObj.afterWhiteIndex! + 0.5;
          const totalWhiteKeys = KEYS.filter(k => k.type === 'white').length;
          const x = (index / totalWhiteKeys) * ctx.canvas.width + (ctx.canvas.width / (totalWhiteKeys * 2));
          
          const gradient = ctx.createRadialGradient(x, ctx.canvas.height, 0, x, ctx.canvas.height, 200);
          gradient.addColorStop(0, 'rgba(245, 158, 11, 0.6)');
          gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.2)');
          gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
          
          ctx.fillStyle = gradient;
          ctx.fillRect(x - 200, ctx.canvas.height - 200, 400, 200);
        }
      });
      
      animationFrameRef.current = requestAnimationFrame(render);
    };
    
    animationFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [showVisualizer, isPlayingDemo, isPracticeMode, isLooping, playNote, stopNote, selectedSong, playbackSpeed]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      const keyObj = KEYS.find(k => k.keyBind === key);
      if (keyObj) {
        playNote(keyObj.note, keyObj.freq);
      }
      const droneObj = DRONES.find(d => d.keyBind === key);
      if (droneObj) {
        toggleDrone(droneObj.note, droneObj.freq);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const keyObj = KEYS.find(k => k.keyBind === key);
      if (keyObj) {
        stopNote(keyObj.note);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [playNote, stopNote, toggleDrone]);

  const whiteKeys = KEYS.filter(k => k.type === 'white');
  const blackKeys = KEYS.filter(k => k.type === 'black');
  const isBellowsActive = activeNotes.size > 0 || activeDrones.size > 0;

  return (
    <div className="min-h-screen bg-[#0a0502] flex flex-col font-sans select-none overflow-hidden relative">
      {/* Soothing Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,#2a160b_0%,transparent_70%)] opacity-40 pointer-events-none animate-pulse-slow"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_80%,#3e2312_0%,transparent_50%)] opacity-20 pointer-events-none animate-pulse-slower"></div>
      
      {/* Header / Controls */}
      <div className="absolute top-4 right-4 text-stone-400 flex gap-4 z-50">
        <button onClick={() => setShowSettings(!showSettings)} className="hover:text-white transition-colors bg-stone-900/50 p-2 rounded-full backdrop-blur">
          <Settings size={20} />
        </button>
        <button onClick={toggleMute} className="hover:text-white transition-colors bg-stone-900/50 p-2 rounded-full backdrop-blur">
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute top-16 right-4 bg-stone-900/90 backdrop-blur text-stone-200 p-4 rounded-lg shadow-2xl z-50 w-72 border border-stone-700 flex flex-col max-h-[70vh]">
          <div className="flex justify-between items-center mb-4 flex-shrink-0">
            <h3 className="font-bold text-lg flex items-center gap-2"><SlidersHorizontal size={18}/> Settings</h3>
            <button onClick={() => setShowSettings(false)} className="hover:text-white"><X size={18}/></button>
          </div>
          
          <div className="space-y-4 text-sm overflow-y-auto pr-2 custom-scrollbar">
            <div>
              <label className="block mb-1">Volume</label>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-full accent-amber-600" />
            </div>
            
            <div>
              <label className="block mb-1">Brightness (Filter)</label>
              <input type="range" min="500" max="5000" step="100" value={filterFreq} onChange={(e) => setFilterFreq(parseFloat(e.target.value))} className="w-full accent-amber-600" />
            </div>

            <div>
              <label className="block mb-1">Reverb</label>
              <input type="range" min="0" max="1" step="0.01" value={reverb} onChange={(e) => setReverb(parseFloat(e.target.value))} className="w-full accent-amber-600" />
            </div>

            <div>
              <label className="block mb-1">Transpose (Semitones)</label>
              <div className="flex items-center gap-2">
                <input type="range" min="-12" max="12" step="1" value={transpose} onChange={(e) => setTranspose(parseInt(e.target.value))} className="w-full accent-amber-600" />
                <span className="w-8 text-right font-mono">{transpose > 0 ? `+${transpose}` : transpose}</span>
              </div>
            </div>

            <div>
              <label className="block mb-1">Fine Tuning (A={fineTune}Hz)</label>
              <div className="flex items-center gap-2">
                <input type="range" min="430" max="450" step="0.1" value={fineTune} onChange={(e) => setFineTune(parseFloat(e.target.value))} className="w-full accent-amber-600" />
                <span className="w-12 text-right font-mono text-xs">{fineTune}</span>
              </div>
            </div>

            <div>
              <label className="block mb-1">Sound Preset</label>
              <select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-full bg-stone-800 border border-stone-700 rounded p-1 text-stone-200">
                <option value="classic">Classic Reed</option>
                <option value="bright">Bright Reed</option>
                <option value="mellow">Mellow</option>
                <option value="double">Double Reed (Octave)</option>
              </select>
            </div>

            <div className="pt-2 border-t border-stone-700 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={couplerEnabled} onChange={(e) => setCouplerEnabled(e.target.checked)} className="accent-amber-600" />
                <Music size={16} /> Octave Coupler
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={chorusEnabled} onChange={(e) => setChorusEnabled(e.target.checked)} className="accent-amber-600" />
                <Activity size={16} /> Chorus Effect
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showVisualizer} onChange={(e) => setShowVisualizer(e.target.checked)} className="accent-amber-600" />
                <Activity size={16} /> Show Visualizer & Particles
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={midiEnabled} onChange={(e) => setMidiEnabled(e.target.checked)} className="accent-amber-600" />
                <Music size={16} /> Enable MIDI Input
              </label>
              {midiError && (
                <div className="text-red-400 text-xs mt-1 bg-red-900/20 p-2 rounded border border-red-800/50">
                  {midiError}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-stone-700 space-y-3">
              <h4 className="font-bold text-sm text-stone-400">Playback & Practice</h4>
              
              <div>
                <label className="block mb-1 text-xs">Song</label>
                <select value={selectedSong} onChange={(e) => setSelectedSong(e.target.value)} className="w-full bg-stone-800 border border-stone-700 rounded p-1 text-stone-200 text-sm">
                  <option value="scale">C Major Scale</option>
                  <option value="twinkle">Twinkle Twinkle</option>
                  <option value="fur_elise">Für Elise (Excerpt)</option>
                  <option value="canon_in_d">Canon in D (Excerpt)</option>
                  <option value="ode_to_joy">Ode to Joy</option>
                  <option value="happy_birthday">Happy Birthday</option>
                  <option value="jingle_bells">Jingle Bells</option>
                  <option value="raga_yaman">Raga Yaman (Aaroh/Avaroh)</option>
                  <option value="raga_bhairav">Raga Bhairav (Aaroh/Avaroh)</option>
                  <option value="raga_hansadhwani">Raga Hansadhwani (Aaroh/Avaroh)</option>
                  <option value="jana_gana_mana">Hindi: Jana Gana Mana</option>
                  <option value="vaishnav_jan_to">Gujarati: Vaishnav Jan To</option>
                  <option value="lollipop_lagelu">Bhojpuri: Lollipop Lagelu</option>
                  {recordedNotes.length > 0 && <option value="recording">Your Recording</option>}
                </select>
              </div>

              <div>
                <label className="block mb-1 text-xs">Speed: {playbackSpeed}x</label>
                <input type="range" min="0.25" max="2.0" step="0.25" value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} className="w-full accent-amber-600" />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input type="checkbox" checked={isPracticeMode} onChange={(e) => setIsPracticeMode(e.target.checked)} className="accent-amber-600" />
                  Practice Mode
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input type="checkbox" checked={isLooping} onChange={(e) => setIsLooping(e.target.checked)} className="accent-amber-600" />
                  Loop
                </label>
              </div>

              {isPracticeMode && isPlayingDemo && (
                <div className="bg-stone-950 p-2 rounded text-xs flex justify-between border border-stone-800">
                  <span className="text-green-400">Hits: {score.hits}</span>
                  <span className="text-red-400">Misses: {score.misses}</span>
                  <span className="text-amber-400">Streak: {score.streak}</span>
                </div>
              )}

              <button 
                onClick={toggleDemo}
                className={`w-full flex items-center justify-center gap-2 py-1.5 rounded transition-colors ${isPlayingDemo ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'}`}
              >
                {isPlayingDemo ? <Square size={16} /> : <Play size={16} />}
                {isPlayingDemo ? 'Stop' : 'Play'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visualizer Canvas */}
      {showVisualizer && (
        <div className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-hidden" style={{ perspective: '1000px' }}>
          <canvas 
            ref={canvasRef} 
            width={1200} 
            height={800} 
            className="w-full h-full opacity-90"
            style={{ mixBlendMode: 'screen', transform: 'rotateX(45deg) scaleY(1.5) translateY(-20%)', transformOrigin: 'bottom' }}
          />
        </div>
      )}

      {/* Spacer for visualizer */}
      <div className="flex-1" />

      {/* Main Harmonium Body */}
      <div className="w-full max-w-6xl mx-auto bg-[#3e2312] rounded-t-xl shadow-2xl border-t-[12px] border-x-[12px] border-[#2a160b] p-4 flex flex-col gap-4 relative z-20 mt-auto">
        {/* Wood grain texture overlay */}
        <div className="absolute inset-0 opacity-20 pointer-events-none rounded-t-xl" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>
        
        {/* Bellows (Visual only, behind the controls) */}
        <div className={`absolute -top-8 left-8 right-8 h-8 rounded-t-lg border-4 border-[#1a0d05] overflow-hidden shadow-inner origin-bottom z-0 ${isBellowsActive ? 'animate-pump-v' : ''}`}>
           <div className="absolute inset-0 bellows-bg-v opacity-90"></div>
        </div>

        {/* Controls / Drones / Recording */}
        <div className="bg-[#2a160b] p-4 rounded-lg flex flex-wrap gap-6 justify-between items-center border-b-8 border-[#1a0d05] shadow-inner relative z-10">
          <div className="flex gap-4 items-center">
            <button 
              onClick={toggleRecord}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm transition-all shadow-lg ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-stone-300 text-stone-900 hover:bg-stone-200'}`}
            >
              <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-white' : 'bg-red-600'}`}></div>
              {isRecording ? 'Recording...' : 'Record'}
            </button>
            
            {recordedNotes.length > 0 && !isRecording && (
              <button 
                onClick={playRecording}
                disabled={isPlayingDemo}
                className="flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm bg-amber-600 text-white hover:bg-amber-500 transition-all shadow-lg disabled:opacity-50"
              >
                <Play size={16} /> Play Recording
              </button>
            )}
          </div>

          <div className="text-stone-500 font-serif italic text-xl hidden md:block">
            Virtual Harmonium
          </div>

          <div className="flex gap-4">
             {DRONES.map(drone => (
               <div key={drone.note} className="flex flex-col items-center gap-2">
                 <button
                   onPointerDown={(e) => { e.preventDefault(); toggleDrone(drone.note, drone.freq); }}
                   className={`w-10 h-10 rounded-full border-4 transition-all ${
                     activeDrones.has(drone.note)
                       ? 'bg-amber-500 border-amber-700 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)] scale-95'
                       : 'bg-stone-300 border-stone-500 shadow-md'
                   }`}
                 />
                 <span className="text-[10px] font-bold text-stone-300 uppercase tracking-wider text-center leading-tight">
                   {drone.label}<br/>({drone.keyBind})
                 </span>
               </div>
             ))}
          </div>
        </div>

        {/* Keyboard */}
        <div className="relative h-48 md:h-56 bg-[#111] p-1 flex shadow-inner touch-none overflow-x-auto overflow-y-hidden scrollbar-hide w-full border-t-4 border-[#222] z-20 rounded-b-lg" style={{ perspective: '800px' }}>
          <div className="flex min-w-[800px] w-full h-full relative mx-auto" style={{ transformStyle: 'preserve-3d' }}>
            {/* Render white keys */}
            {whiteKeys.map((key) => (
              <div
                key={key.note}
                className={`flex-1 mx-[1px] rounded-b-md border border-stone-400 relative flex flex-col justify-end pb-2 items-center transition-all duration-75 cursor-pointer origin-top
                  ${activeNotes.has(key.note) ? 'bg-gradient-to-b from-[#e8e8d8] to-[#d0d0c0] shadow-[inset_0_4px_10px_rgba(0,0,0,0.4),0_0_20px_rgba(245,158,11,0.8)] translate-y-[4px] rotate-x-2 h-[calc(100%-2px)] z-0' : 'bg-gradient-to-b from-[#ffffff] to-[#f0f0f0] shadow-[inset_0_-2px_4px_rgba(0,0,0,0.2),0_4px_4px_rgba(0,0,0,0.4)] h-full z-0'}
                `}
                onPointerDown={(e) => { e.preventDefault(); playNote(key.note, key.freq); }}
                onPointerUp={(e) => { e.preventDefault(); stopNote(key.note); }}
                onPointerLeave={(e) => { e.preventDefault(); stopNote(key.note); }}
                onPointerEnter={(e) => { e.preventDefault(); if (e.buttons > 0) playNote(key.note, key.freq); }}
              >
                {key.keyBind && <span className="text-stone-400 text-[9px] font-mono mb-1">{key.keyBind.toUpperCase()}</span>}
              </div>
            ))}

            {/* Render black keys */}
            {blackKeys.map((key) => {
              const totalWhiteKeys = whiteKeys.length;
              const leftPos = ((key.afterWhiteIndex! + 1) * (100 / totalWhiteKeys));
              return (
                <div
                  key={key.note}
                  className={`absolute top-0 w-[2.5%] z-10 rounded-b-md flex flex-col justify-end pb-2 items-center transition-all duration-75 cursor-pointer origin-top
                    ${activeNotes.has(key.note) ? 'bg-gradient-to-b from-[#111] to-[#000] shadow-[inset_0_3px_6px_rgba(255,255,255,0.1),0_0_20px_rgba(245,158,11,0.8)] translate-y-[4px] rotate-x-2 h-[58%]' : 'bg-gradient-to-b from-[#222] to-[#0a0a0a] shadow-[inset_0_-2px_4px_rgba(255,255,255,0.1),0_4px_6px_rgba(0,0,0,0.6)] h-[60%]'}
                  `}
                  style={{ left: `calc(${leftPos}% - 1.25%)` }}
                  onPointerDown={(e) => { e.preventDefault(); playNote(key.note, key.freq); }}
                  onPointerUp={(e) => { e.preventDefault(); stopNote(key.note); }}
                  onPointerLeave={(e) => { e.preventDefault(); stopNote(key.note); }}
                  onPointerEnter={(e) => { e.preventDefault(); if (e.buttons > 0) playNote(key.note, key.freq); }}
                >
                  {key.keyBind && <span className="text-stone-500 text-[8px] font-mono mb-1">{key.keyBind.toUpperCase()}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Instructions Overlay */}
      {!isReady && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-stone-900 border border-stone-800 p-8 rounded-xl max-w-md text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-4">Virtual Harmonium</h2>
            <p className="text-stone-400 mb-6 text-sm">
              Play using your mouse, touch screen, or keyboard.
              <br/><br/>
              <strong>White Keys:</strong> Z X C V B N M Q W E R T Y U I O P [ ]<br/>
              <strong>Black Keys:</strong> S D G H J 2 3 5 6 7 9 0 =<br/>
            </p>
            <button 
              onClick={initAudio}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              Start Playing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
