import { Signal } from "../index.js";

export interface QQuickItemBase {
  readonly objectName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  visible: boolean;
  enabled: boolean;
  opacity: number;
  rotation: number;
  scale: number;
  parent: QQuickItemBase | null;
  readonly children: readonly QQuickItemBase[];

  readonly onXChanged: Signal<(value: number) => void>;
  readonly onYChanged: Signal<(value: number) => void>;
  readonly onWidthChanged: Signal<(value: number) => void>;
  readonly onHeightChanged: Signal<(value: number) => void>;
  readonly onVisibleChanged: Signal<(value: boolean) => void>;
  readonly onEnabledChanged: Signal<(value: boolean) => void>;
  readonly onOpacityChanged: Signal<(value: number) => void>;
  readonly onRotationChanged: Signal<(value: number) => void>;
  readonly onScaleChanged: Signal<(value: number) => void>;
  readonly onCompleted: Signal<() => void>;
  readonly onDestruction: Signal<() => void>;

  mapToItem(item: QQuickItemBase, x: number, y: number): { x: number; y: number };
  mapFromItem(item: QQuickItemBase, x: number, y: number): { x: number; y: number };
  forceActiveFocus(): void;
  grabToImage(callback: (result: unknown) => void): boolean;
}

export interface QQuickRectangle extends QQuickItemBase {
  color: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
  gradient?: any;
}

export interface QQuickText extends QQuickItemBase {
  text: string;
  color: string;
  fontFamily: string;
  fontPixelSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  horizontalAlignment: "AlignLeft" | "AlignRight" | "AlignHCenter" | "AlignJustify";
  verticalAlignment: "AlignTop" | "AlignBottom" | "AlignVCenter";
  wrapMode: "NoWrap" | "WordWrap" | "WrapAnywhere" | "Wrap";
  lineHeight: number;
  elide: "ElideNone" | "ElideLeft" | "ElideMiddle" | "ElideRight";

  readonly onTextChanged: Signal<(value: string) => void>;
  readonly onLinkActivated: Signal<(link: string) => void>;
}

export interface QQuickImage extends QQuickItemBase {
  source: string;
  fillMode: "Stretch" | "PreserveAspectFit" | "PreserveAspectCrop" | "Tile" | "TileVertically" | "TileHorizontally" | "Pad";
  sourceSize: { width: number; height: number };
  asynchronous: boolean;
  cache: boolean;
  mirror: boolean;

  readonly onStatusChanged: Signal<(status: number) => void>;
}

export interface QQuickMouseArea extends QQuickItemBase {
  containsMouse: boolean;
  containsPress: boolean;
  hoverEnabled: boolean;
  cursorShape: number;
  acceptedButtons: number;

  readonly onClicked: Signal<(mouse: QMouseEvent) => void>;
  readonly onPressed: Signal<(mouse: QMouseEvent) => void>;
  readonly onReleased: Signal<(mouse: QMouseEvent) => void>;
  readonly onDoubleClicked: Signal<(mouse: QMouseEvent) => void>;
  readonly onEntered: Signal<() => void>;
  readonly onExited: Signal<() => void>;
  readonly onPositionChanged: Signal<(mouse: QMouseEvent) => void>;
  readonly onWheel: Signal<(wheel: QWheelEvent) => void>;
}

export interface QMouseEvent {
  x: number;
  y: number;
  button: number;
  buttons: number;
  modifiers: number;
  wasHeld: boolean;
  accepted: boolean;
}

export interface QWheelEvent {
  x: number;
  y: number;
  angleDelta: { x: number; y: number };
  pixelDelta: { x: number; y: number };
  buttons: number;
  modifiers: number;
  accepted: boolean;
}

export interface QQuickAbstractButton extends QQuickItemBase {
  text: string;
  down: boolean;
  checked: boolean;
  checkable: boolean;
  highlighted: boolean;
  flat: boolean;
  icon: { source: string; color?: string; width?: number; height?: number };

  readonly onClicked: Signal<() => void>;
  readonly onPressed: Signal<() => void>;
  readonly onReleased: Signal<() => void>;
  readonly onPressAndHold: Signal<() => void>;
  readonly onCheckedChanged: Signal<(checked: boolean) => void>;
  readonly onToggled: Signal<(checked: boolean) => void>;
}

export interface QQuickTextField extends QQuickItemBase {
  text: string;
  placeholderText: string;
  readOnly: boolean;
  echoMode: "Normal" | "Password" | "PasswordEchoOnEdit" | "NoEcho";
  maximumLength: number;
  validator?: any;
  inputMask?: string;

  readonly onTextChanged: Signal<(text: string) => void>;
  readonly onTextEdited: Signal<(text: string) => void>;
  readonly onEditingFinished: Signal<() => void>;
  readonly onAccepted: Signal<() => void>;
}

export interface QQuickColumn extends QQuickItemBase {
  spacing: number;
  padding: number;
}

export interface QQuickRow extends QQuickItemBase {
  spacing: number;
  padding: number;
}

export interface QQuickFlickable extends QQuickItemBase {
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  flickableDirection: number;
  boundsBehavior: number;
  clip: boolean;

  readonly onMovementStarted: Signal<() => void>;
  readonly onMovementEnded: Signal<() => void>;
  readonly onFlickStarted: Signal<() => void>;
  readonly onFlickEnded: Signal<() => void>;
}

export interface QQuickListView extends QQuickFlickable {
  model: any;
  delegate: any;
  currentIndex: number;
  currentItem: any;
  count: number;
  section: {
    property: string;
    criteria: string;
    delegate: any;
  };

  readonly onCurrentIndexChanged: Signal<(index: number) => void>;
  readonly onCurrentItemChanged: Signal<(item: any) => void>;
}

export interface QQuickGridView extends QQuickFlickable {
  model: any;
  delegate: any;
  cellWidth: number;
  cellHeight: number;
  currentIndex: number;
  currentItem: any;
}

export interface QQuickLoader extends QQuickItemBase {
  source: string;
  sourceComponent: any;
  item: any;
  active: boolean;
  asynchronous: boolean;

  readonly onLoaded: Signal<() => void>;
}

export interface QQuickRepeater {
  model: any;
  delegate: any;
  count: number;

  readonly onItemAdded: Signal<(index: number, item: any) => void>;
  readonly onItemRemoved: Signal<(index: number, item: any) => void>;
}

export interface QQmlTimer {
  interval: number;
  running: boolean;
  repeat: boolean;
  triggeredOnStart: boolean;

  readonly onTriggered: Signal<() => void>;

  start(): void;
  stop(): void;
  restart(): void;
}

export interface QQmlAnimation {
  running: boolean;
  paused: boolean;
  alwaysRunToEnd: boolean;
  loops: number;

  readonly onStarted: Signal<() => void>;
  readonly onStopped: Signal<() => void>;
  readonly onFinished: Signal<() => void>;

  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  complete(): void;
}

export interface QQuickNumberAnimation extends QQmlAnimation {
  target: QQuickItemBase | null;
  property: string;
  from: number;
  to: number;
  duration: number;
  easing: {
    type: string;
    amplitude: number;
    overshoot: number;
    period: number;
    bezierCurve: { x: number; y: number }[];
  };
}

export interface QQmlPropertyChanges {
  target: QQuickItemBase | null;
  explicit?: boolean;
  restoreEntryValues?: boolean;
}
