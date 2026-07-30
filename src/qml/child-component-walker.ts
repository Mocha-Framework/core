import { QmlAstParser, type QmlElement, type QmlDocument } from "./qml-ast-parser.js";
import { getTagRegistry } from "./qml-component.js";

/**
 * Built-in QML tags that should NOT be treated as child controllers,
 * even though they start with an uppercase letter.
 */
const BUILTIN_TAGS = new Set([
  "AnchorChanges", "Animation", "Animator", "ApplicationWindow",
  "Binding", "BorderImage", "BusyIndicator", "Button",
  "ButtonGroup", "Canvas", "ChartView", "CheckBox", "CheckDelegate",
  "Clip", "ColorAnimation", "ColorGroup", "ComboBox", "Component",
  "Container", "Control", "Curve", "DatePicker", "DelayButton",
  "Dial", "Dialog", "DialogButtonBox", "Drawer", "DropArea",
  "DynamicCreator", "EnterKey", "EventPoint", "Flickable",
  "Flipable", "Flow", "FocusScope", "FontLoader", "Frame",
  "Gradient", "GraphicsInfo", "Grid", "GridLayout", "GridView",
  "GroupBox", "HeaderView", "HoverHandler", "Image", "InputHandler",
  "Item", "ItemDelegate", "ItemGrabResult", "Joystick", "KeyEvent",
  "KeyNavigation", "KeyboardRectangle", "KeyboardSpace", "Keys",
  "Label", "Layout", "LayoutMirror", "LevelChange", "ListModel",
  "ListView", "Loader", "Matrix4x4", "Menu", "MenuBar",
  "MenuBarItem", "MenuItem", "MenuSeparator", "MouseArea",
  "MultiPointTouchArea", "NumberAnimation", "OpacityAnimator",
  "Orientation", "PaddedRectangle", "Page", "PageIndicator",
  "PinchArea", "PinchHandler", "PlasmaCore", "PointHandler",
  "Popup", "ProgressBar", "PropertyAnimation", "PushButton",
  "QQ", "QQuickItem", "QQuickWindow", "Quaternion", "RadioButton",
  "RadioDelegate", "RangeSlider", "RectangularShadow", "Rectangle",
  "RegExpValidator", "Repeater", "RoundButton", "Row", "RowLayout",
  "Scene3D", "ScrollBar", "ScrollIndicator", "ScrollView",
  "SelectionRectangle", "SequentialAnimation", "Settings", "ShaderEffect",
  "ShaderEffectSource", "Shortcut", "SignalTransition", "Slider",
  "SpinBox", "SplitView", "StackLayout", "StackView", "State",
  "StateChangeScript", "StateGroup", "StatusBar", "StatusIndicator",
  "StringListModel", "SwipeDelegate", "SwipeView", "Switch",
  "SwitchDelegate", "SystemPalette", "Tab", "TabBar", "TableModel",
  "TableView", "TapHandler", "Text", "TextArea", "TextEdit",
  "TextField", "TextInput", "Theme", "TimeLine", "Timer", "ToolBar",
  "ToolButton", "ToolSeparator", "ToolTip", "TouchPoint", "Transform",
  "Transition", "TreeViewDelegate", "Tree", "Tumbler", "Vector3dAnimation",
  "Vector4d", "VectorImage", "ViewTransition", "ViewStub", "WheelHandler",
  "Window", "XAnimator", "YAnimator", "ZoomBar",
  // From MochaDS:
  "Card", "Modal", "Sidebar", "Accordion", "Tabs", "Stepper", "Steps",
  "StepsSlider", "SteppedProgress", "VStack", "HStack", "AdaptiveStack",
  "Div", "Box", "CozyGrid", "CozyGridCol", "CozyList", "Separator",
  "Span", "Case", "Switcher", "Router", "Route", "RouterLink",
  "NavigationBar", "NavigationItem", "Breadcrumb", "Shell", "SidebarItem",
  "SidebarHeader", "SidebarFooter", "SidebarSection", "Paginator",
  "Toast", "ToastManager", "Tag", "Tile", "AlertDialog", "EmptyState",
  "CozySkeleton", "CozySpinner", "AnimatedNumber", "Avatar",
  "ItemsPerPage", "Tooltip", "Popover", "BarChart", "LineChart",
  "PieChart", "RadarChart", "GaugeChart", "ChartTooltip", "DataGrid",
  "Table", "TreeTable", "SortableList", "InteractiveListCell",
  "MochaMap", "AnimatedPresence", "Bounce", "FadeIn", "FadeOut", "Flip",
  "GlowPulse", "Particles", "SlideDown", "SlideLeft", "SlideRight",
  "SlideUp", "SlideOutDown", "SlideOutUp", "Spin", "ZoomIn",
  "LucideIcon", "MochaLogo", "StripedFill", "Icon", "HeroCarousel",
  "FocusRing", "HoverCard", "ContextMenu", "Draggable", "DropZone",
  "ScrollBar", "MediaQuery", "Pipes", "ThemeGenerated",
  "MochaI18n", "H1", "H2", "H3", "H4", "P", "AnimateList",
  "ButtonGroupItem", "ToggleButton", "CozyColorPicker", "ColorPicker",
  "DatePicker", "PinInput", "RangeSelector", "Select", "AdvancedSelect",
  "SelectTree", "RadioGroup", "Form", "FormField", "FormController",
  "DynamicForm", "TextEditor", "AdvancedTextEditor",
  "Window", "ApplicationWindow",
]);

const parser = new QmlAstParser();

export interface ChildComponentUsage {
  /** The QML tag as written in the source (e.g. `Child`). */
  tag: string;
  /** The registered controller class. */
  classCtor: Function;
  /** The component name (e.g. `ChildController`). */
  componentName: string;
  /** The QML element node for further inspection. */
  element: QmlElement;
  /** Attributes set on the tag (`name: controller.foo`, `value: 42`, etc.). */
  attrs: Record<string, string>;
  /** The `id` attribute if present. */
  id: string | null;
}

/**
 * Walk a QML source string and find all child component usages.
 *
 * A child component is a PascalCase tag whose name matches a registered
 * `@QMLComponent` (via `as` option or `Controller` suffix stripping).
 * Built-in QML / MochaDS tags are filtered out.
 *
 * Recurses into the QML tree, so child components nested inside other
 * elements are also found.
 */
export function findChildComponentUsages(qml: string): ChildComponentUsage[] {
  const registry = getTagRegistry();
  if (registry.size === 0) return [];

  const doc = parser.parse(qml);
  const results: ChildComponentUsage[] = [];

  if (!doc.root) return results;

  walkElements(doc.root, (el) => {
    if (el.tag === "#text") return;
    if (!isPascalCase(el.tag)) return;
    if (BUILTIN_TAGS.has(el.tag)) return;

    const classCtor = registry.get(el.tag);
    if (!classCtor) return;

    const meta = (classCtor as any).__qmlComponent;
    if (!meta) return;

    results.push({
      tag: el.tag,
      classCtor,
      componentName: meta.componentName,
      element: el,
      attrs: el.attrs,
      id: el.id,
    });
  });

  return results;
}

/**
 * Walk all QML elements in a document (recursive).
 */
function walkElements(root: QmlElement, fn: (el: QmlElement) => void): void {
  fn(root);
  for (const child of root.children) {
    walkElements(child, fn);
  }
}

function isPascalCase(s: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(s);
}

/**
 * Determine whether a tag is a registered child component, given a tag name.
 * Useful for inline checks before forming parser results.
 */
export function isChildComponentTag(tag: string): boolean {
  if (!isPascalCase(tag)) return false;
  if (BUILTIN_TAGS.has(tag)) return false;
  return getTagRegistry().has(tag);
}
