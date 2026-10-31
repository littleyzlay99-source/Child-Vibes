import type { MultiplayerRacePhase, SnowRushSteerAxis } from './engine/multiplayerTypes';
import type { SnowRushConnectionStatus, SnowRushInputIntent } from './network/SnowRushSocketClient';

/**
 * Snow Rush: Avalanche Escape — Step 4.8 Pure Online Input Controller
 *
 * Manages keyboard + mobile touch input state for Online Multiplayer Mode:
 * - Emits ONLY `{ steer: -1 | 0 | 1, jumpPressed, useItemPressed }`
 * - Blocks `useItemPressed` auto-repeat (`isRepeat === true`) when holding Item key
 * - Blocks input transmission when disconnected, not in `'racing' | 'finish_window'`, or local racer finished
 * - Flushes a clean neutral frame on `blur` / `visibilitychange` if steering/jumping was active while connected
 */

export interface OnlineInputGateState {
  readonly connectionStatus: SnowRushConnectionStatus;
  readonly racePhase: MultiplayerRacePhase;
  readonly localFinished: boolean;
}

export class SnowRushOnlineInputController {
  private readonly emitInput: (intent: SnowRushInputIntent) => void;
  private gate: OnlineInputGateState = {
    connectionStatus: 'idle',
    racePhase: 'ready',
    localFinished: false,
  };

  private keyLeft = false;
  private keyRight = false;
  private keyJump = false;

  private touchLeft = false;
  private touchRight = false;
  private touchJump = false;

  private itemKeyHeld = false;
  private lastEmittedSteer: SnowRushSteerAxis = 0;
  private lastEmittedJump = false;

  constructor(emitInput: (intent: SnowRushInputIntent) => void) {
    this.emitInput = emitInput;
  }

  public isInputAllowed(): boolean {
    if (this.gate.connectionStatus !== 'connected') {
      return false;
    }
    if (this.gate.localFinished) {
      return false;
    }
    return this.gate.racePhase === 'racing' || this.gate.racePhase === 'finish_window';
  }

  public updateGate(nextGate: OnlineInputGateState): void {
    const wasAllowed = this.isInputAllowed();
    this.gate = nextGate;
    const nowAllowed = this.isInputAllowed();

    if (wasAllowed && !nowAllowed) {
      this.resetAllInputs();
    }
  }

  public getCurrentSteer(): SnowRushSteerAxis {
    const left = this.keyLeft || this.touchLeft;
    const right = this.keyRight || this.touchRight;
    if (left && !right) return -1;
    if (right && !left) return 1;
    return 0;
  }

  public getCurrentJump(): boolean {
    return this.keyJump || this.touchJump;
  }

  public setKeySteerLeft(pressed: boolean): void {
    if (this.keyLeft === pressed) return;
    this.keyLeft = pressed;
    this.flushContinuousState();
  }

  public setKeySteerRight(pressed: boolean): void {
    if (this.keyRight === pressed) return;
    this.keyRight = pressed;
    this.flushContinuousState();
  }

  public setKeyJump(pressed: boolean): void {
    if (this.keyJump === pressed) return;
    this.keyJump = pressed;
    this.flushContinuousState();
  }

  public setTouchSteerLeft(pressed: boolean): void {
    if (this.touchLeft === pressed) return;
    this.touchLeft = pressed;
    this.flushContinuousState();
  }

  public setTouchSteerRight(pressed: boolean): void {
    if (this.touchRight === pressed) return;
    this.touchRight = pressed;
    this.flushContinuousState();
  }

  public setTouchJump(pressed: boolean): void {
    if (this.touchJump === pressed) return;
    this.touchJump = pressed;
    this.flushContinuousState();
  }

  /**
   * Fires a single manual item activation pulse.
   * Ignores keyboard `e.repeat` and ignores held-down duplicate keydowns until released.
   */
  public triggerManualItem(options?: { readonly isRepeat?: boolean; readonly fromKeyboard?: boolean }): boolean {
    if (options?.isRepeat) {
      return false;
    }
    if (options?.fromKeyboard) {
      if (this.itemKeyHeld) {
        return false;
      }
      this.itemKeyHeld = true;
    }

    if (!this.isInputAllowed()) {
      return false;
    }

    const steer = this.getCurrentSteer();
    const jumpPressed = this.getCurrentJump();
    this.lastEmittedSteer = steer;
    this.lastEmittedJump = jumpPressed;

    this.emitInput({
      steer,
      jumpPressed,
      useItemPressed: true,
    });
    return true;
  }

  public releaseItemKey(): void {
    this.itemKeyHeld = false;
  }

  /**
   * Clears all held keyboard/touch states on blur, visibilitychange, disconnect, or unmount.
   * If currently connected & active and a non-neutral input was held, sends one clean neutral frame.
   */
  public resetAllInputs(): void {
    const hadActiveSentState = this.lastEmittedSteer !== 0 || this.lastEmittedJump;

    this.keyLeft = false;
    this.keyRight = false;
    this.keyJump = false;
    this.touchLeft = false;
    this.touchRight = false;
    this.touchJump = false;
    this.itemKeyHeld = false;
    this.lastEmittedSteer = 0;
    this.lastEmittedJump = false;

    if (hadActiveSentState && this.isInputAllowed()) {
      this.emitInput({
        steer: 0,
        jumpPressed: false,
        useItemPressed: false,
      });
    }
  }

  private flushContinuousState(): void {
    if (!this.isInputAllowed()) {
      return;
    }
    const steer = this.getCurrentSteer();
    const jumpPressed = this.getCurrentJump();

    if (steer === this.lastEmittedSteer && jumpPressed === this.lastEmittedJump) {
      return;
    }

    this.lastEmittedSteer = steer;
    this.lastEmittedJump = jumpPressed;
    this.emitInput({
      steer,
      jumpPressed,
      useItemPressed: false,
    });
  }
}
