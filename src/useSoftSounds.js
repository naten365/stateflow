import { useCallback, useEffect, useRef } from 'react';

export default function useSoftSounds(enabled, keyboardVolume) {
  const contextRef = useRef(null);
  const lastTypeSound = useRef(0);
  const lastPencilSound = useRef(0);
  const keyboardBufferRef = useRef(null);

  const playTone = useCallback((config) => {
    if (!enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = contextRef.current || new AudioContext();
    contextRef.current = context;
    if (context.state === 'suspended') context.resume();

    const now = context.currentTime;
    const output = context.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(config.volume, now + 0.012);
    output.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
    output.connect(context.destination);

    config.frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      oscillator.type = config.type ?? 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * config.slide, now + config.duration);
      filter.type = 'lowpass';
      filter.frequency.value = config.filter + index * 120;
      oscillator.connect(filter);
      filter.connect(output);
      oscillator.start(now);
      oscillator.stop(now + config.duration + 0.02);
    });
  }, [enabled]);

  const playType = useCallback(() => {
    const now = performance.now();
    if (!enabled || now - lastTypeSound.current < 42) return;
    lastTypeSound.current = now;
    const context = contextRef.current;
    const buffer = keyboardBufferRef.current;
    if (!context || !buffer) return;
    if (context.state === 'suspended') context.resume();

    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    filter.type = 'lowpass';
    filter.frequency.value = 3600 + Math.random() * 800;
    gain.gain.value = keyboardVolume * (0.72 + Math.random() * 0.18);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();
    source.stop(context.currentTime + 0.105);
  }, [enabled, keyboardVolume]);

  const playLeftClick = useCallback(() => {
    playTone({ frequencies: [360, 740], duration: 0.07, volume: 0.021, filter: 1200, type: 'sine', slide: 1.04 });
  }, [playTone]);

  const playRightClick = useCallback(() => {
    playTone({ frequencies: [220, 430], duration: 0.095, volume: 0.019, filter: 940, type: 'sine', slide: 0.84 });
  }, [playTone]);

  const playPencil = useCallback(() => {
    const now = performance.now();
    if (!enabled || now - lastPencilSound.current < 70) return;
    lastPencilSound.current = now;
    playTone({ frequencies: [920 + Math.random() * 80], duration: 0.075, volume: 0.009, filter: 1800, type: 'triangle', slide: 0.96 });
  }, [enabled, playTone]);

  useEffect(() => {
    if (!enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = contextRef.current || new AudioContext();
    contextRef.current = context;
    let cancelled = false;

    fetch('/audio/mechanical-keyboard.mp3')
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        if (!cancelled) keyboardBufferRef.current = buffer;
      })
      .catch(() => {
        keyboardBufferRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { playType, playPencil, playLeftClick, playRightClick };
}
