// \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
/**
* SSR Window 4.0.2
* Better handling for window object in SSR environment
* https://github.com/nolimits4web/ssr-window
*
* Copyright 2021, Vladimir Kharlampidi
*
* Licensed under MIT
*
* Released on: December 13, 2021
*/
function isObject$3(obj) {
	return obj !== null && typeof obj === "object" && "constructor" in obj && obj.constructor === Object;
}
function extend$3(target = {}, src = {}) {
	Object.keys(src).forEach((key) => {
		if (typeof target[key] === "undefined") target[key] = src[key];
		else if (isObject$3(src[key]) && isObject$3(target[key]) && Object.keys(src[key]).length > 0) extend$3(target[key], src[key]);
	});
}
var ssrDocument$1 = {
	body: {},
	addEventListener() {},
	removeEventListener() {},
	activeElement: {
		blur() {},
		nodeName: ""
	},
	querySelector() {
		return null;
	},
	querySelectorAll() {
		return [];
	},
	getElementById() {
		return null;
	},
	createEvent() {
		return { initEvent() {} };
	},
	createElement() {
		return {
			children: [],
			childNodes: [],
			style: {},
			setAttribute() {},
			getElementsByTagName() {
				return [];
			}
		};
	},
	createElementNS() {
		return {};
	},
	importNode() {
		return null;
	},
	location: {
		hash: "",
		host: "",
		hostname: "",
		href: "",
		origin: "",
		pathname: "",
		protocol: "",
		search: ""
	}
};
function getDocument$1() {
	const doc = typeof document !== "undefined" ? document : {};
	extend$3(doc, ssrDocument$1);
	return doc;
}
var ssrWindow$1 = {
	document: ssrDocument$1,
	navigator: { userAgent: "" },
	location: {
		hash: "",
		host: "",
		hostname: "",
		href: "",
		origin: "",
		pathname: "",
		protocol: "",
		search: ""
	},
	history: {
		replaceState() {},
		pushState() {},
		go() {},
		back() {}
	},
	CustomEvent: function CustomEvent() {
		return this;
	},
	addEventListener() {},
	removeEventListener() {},
	getComputedStyle() {
		return { getPropertyValue() {
			return "";
		} };
	},
	Image() {},
	Date() {},
	screen: {},
	setTimeout() {},
	clearTimeout() {},
	matchMedia() {
		return {};
	},
	requestAnimationFrame(callback) {
		if (typeof setTimeout === "undefined") {
			callback();
			return null;
		}
		return setTimeout(callback, 0);
	},
	cancelAnimationFrame(id) {
		if (typeof setTimeout === "undefined") return;
		clearTimeout(id);
	}
};
function getWindow$1() {
	const win = typeof window !== "undefined" ? window : {};
	extend$3(win, ssrWindow$1);
	return win;
}
/**
* Dom7 4.0.6
* Minimalistic JavaScript library for DOM manipulation, with a jQuery-compatible API
* https://framework7.io/docs/dom7.html
*
* Copyright 2023, Vladimir Kharlampidi
*
* Licensed under MIT
*
* Released on: February 2, 2023
*/
var dom7_esm_exports = /* @__PURE__ */ __exportAll({
	$: () => $,
	add: () => add,
	addClass: () => addClass,
	animate: () => animate,
	animationEnd: () => animationEnd,
	append: () => append,
	appendTo: () => appendTo,
	attr: () => attr$1,
	blur: () => blur,
	change: () => change,
	children: () => children$1,
	click: () => click,
	closest: () => closest,
	css: () => css,
	data: () => data,
	dataset: () => dataset,
	default: () => $,
	detach: () => detach,
	each: () => each,
	empty: () => empty,
	eq: () => eq,
	filter: () => filter,
	find: () => find,
	focus: () => focus,
	focusin: () => focusin,
	focusout: () => focusout,
	hasClass: () => hasClass,
	height: () => height,
	hide: () => hide,
	html: () => html,
	index: () => index,
	insertAfter: () => insertAfter,
	insertBefore: () => insertBefore$1,
	is: () => is,
	keydown: () => keydown,
	keypress: () => keypress,
	keyup: () => keyup,
	mousedown: () => mousedown,
	mouseenter: () => mouseenter,
	mouseleave: () => mouseleave,
	mousemove: () => mousemove,
	mouseout: () => mouseout,
	mouseover: () => mouseover,
	mouseup: () => mouseup,
	next: () => next,
	nextAll: () => nextAll,
	off: () => off,
	offset: () => offset,
	on: () => on,
	once: () => once$1,
	outerHeight: () => outerHeight,
	outerWidth: () => outerWidth,
	parent: () => parent,
	parents: () => parents,
	prepend: () => prepend,
	prependTo: () => prependTo,
	prev: () => prev,
	prevAll: () => prevAll,
	prop: () => prop,
	remove: () => remove,
	removeAttr: () => removeAttr,
	removeClass: () => removeClass,
	removeData: () => removeData,
	resize: () => resize,
	scroll: () => scroll,
	scrollLeft: () => scrollLeft,
	scrollTo: () => scrollTo,
	scrollTop: () => scrollTop,
	show: () => show,
	siblings: () => siblings,
	stop: () => stop,
	styles: () => styles,
	submit: () => submit,
	text: () => text,
	toggleClass: () => toggleClass,
	touchend: () => touchend,
	touchmove: () => touchmove,
	touchstart: () => touchstart,
	transform: () => transform,
	transition: () => transition,
	transitionEnd: () => transitionEnd,
	transitionStart: () => transitionStart,
	trigger: () => trigger,
	val: () => val,
	value: () => value,
	width: () => width
});
function makeReactive(obj) {
	const proto = obj.__proto__;
	Object.defineProperty(obj, "__proto__", {
		get() {
			return proto;
		},
		set(value) {
			proto.__proto__ = value;
		}
	});
}
var Dom7 = class extends Array {
	constructor(items) {
		if (typeof items === "number") super(items);
		else {
			super(...items || []);
			makeReactive(this);
		}
	}
};
function arrayFlat(arr = []) {
	const res = [];
	arr.forEach((el) => {
		if (Array.isArray(el)) res.push(...arrayFlat(el));
		else res.push(el);
	});
	return res;
}
function arrayFilter(arr, callback) {
	return Array.prototype.filter.call(arr, callback);
}
function arrayUnique(arr) {
	const uniqueArray = [];
	for (let i = 0; i < arr.length; i += 1) if (uniqueArray.indexOf(arr[i]) === -1) uniqueArray.push(arr[i]);
	return uniqueArray;
}
function toCamelCase$1(string) {
	return string.toLowerCase().replace(/-(.)/g, (match, group) => group.toUpperCase());
}
function qsa(selector, context) {
	if (typeof selector !== "string") return [selector];
	const a = [];
	const res = context.querySelectorAll(selector);
	for (let i = 0; i < res.length; i += 1) a.push(res[i]);
	return a;
}
function $(selector, context) {
	const window = getWindow$1();
	const document = getDocument$1();
	let arr = [];
	if (!context && selector instanceof Dom7) return selector;
	if (!selector) return new Dom7(arr);
	if (typeof selector === "string") {
		const html = selector.trim();
		if (html.indexOf("<") >= 0 && html.indexOf(">") >= 0) {
			let toCreate = "div";
			if (html.indexOf("<li") === 0) toCreate = "ul";
			if (html.indexOf("<tr") === 0) toCreate = "tbody";
			if (html.indexOf("<td") === 0 || html.indexOf("<th") === 0) toCreate = "tr";
			if (html.indexOf("<tbody") === 0) toCreate = "table";
			if (html.indexOf("<option") === 0) toCreate = "select";
			const tempParent = document.createElement(toCreate);
			tempParent.innerHTML = html;
			for (let i = 0; i < tempParent.childNodes.length; i += 1) arr.push(tempParent.childNodes[i]);
		} else arr = qsa(selector.trim(), context || document);
	} else if (selector.nodeType || selector === window || selector === document) arr.push(selector);
	else if (Array.isArray(selector)) {
		if (selector instanceof Dom7) return selector;
		arr = selector;
	}
	return new Dom7(arrayUnique(arr));
}
$.fn = Dom7.prototype;
function addClass(...classes) {
	const classNames = arrayFlat(classes.map((c) => c.split(" ")));
	this.forEach((el) => {
		el.classList.add(...classNames);
	});
	return this;
}
function removeClass(...classes) {
	const classNames = arrayFlat(classes.map((c) => c.split(" ")));
	this.forEach((el) => {
		el.classList.remove(...classNames);
	});
	return this;
}
function toggleClass(...classes) {
	const classNames = arrayFlat(classes.map((c) => c.split(" ")));
	this.forEach((el) => {
		classNames.forEach((className) => {
			el.classList.toggle(className);
		});
	});
}
function hasClass(...classes) {
	const classNames = arrayFlat(classes.map((c) => c.split(" ")));
	return arrayFilter(this, (el) => {
		return classNames.filter((className) => el.classList.contains(className)).length > 0;
	}).length > 0;
}
function attr$1(attrs, value) {
	if (arguments.length === 1 && typeof attrs === "string") {
		if (this[0]) return this[0].getAttribute(attrs);
		return;
	}
	for (let i = 0; i < this.length; i += 1) if (arguments.length === 2) this[i].setAttribute(attrs, value);
	else for (const attrName in attrs) {
		this[i][attrName] = attrs[attrName];
		this[i].setAttribute(attrName, attrs[attrName]);
	}
	return this;
}
function removeAttr(attr) {
	for (let i = 0; i < this.length; i += 1) this[i].removeAttribute(attr);
	return this;
}
function prop(props, value) {
	if (arguments.length === 1 && typeof props === "string") {
		if (this[0]) return this[0][props];
	} else {
		for (let i = 0; i < this.length; i += 1) if (arguments.length === 2) this[i][props] = value;
		else for (const propName in props) this[i][propName] = props[propName];
		return this;
	}
	return this;
}
function data(key, value) {
	let el;
	if (typeof value === "undefined") {
		el = this[0];
		if (!el) return void 0;
		if (el.dom7ElementDataStorage && key in el.dom7ElementDataStorage) return el.dom7ElementDataStorage[key];
		const dataKey = el.getAttribute(`data-${key}`);
		if (dataKey) return dataKey;
		return;
	}
	for (let i = 0; i < this.length; i += 1) {
		el = this[i];
		if (!el.dom7ElementDataStorage) el.dom7ElementDataStorage = {};
		el.dom7ElementDataStorage[key] = value;
	}
	return this;
}
function removeData(key) {
	for (let i = 0; i < this.length; i += 1) {
		const el = this[i];
		if (el.dom7ElementDataStorage && el.dom7ElementDataStorage[key]) {
			el.dom7ElementDataStorage[key] = null;
			delete el.dom7ElementDataStorage[key];
		}
	}
}
function dataset() {
	const el = this[0];
	if (!el) return void 0;
	const dataset = {};
	if (el.dataset) for (const dataKey in el.dataset) dataset[dataKey] = el.dataset[dataKey];
	else for (let i = 0; i < el.attributes.length; i += 1) {
		const attr = el.attributes[i];
		if (attr.name.indexOf("data-") >= 0) dataset[toCamelCase$1(attr.name.split("data-")[1])] = attr.value;
	}
	for (const key in dataset) if (dataset[key] === "false") dataset[key] = false;
	else if (dataset[key] === "true") dataset[key] = true;
	else if (parseFloat(dataset[key]) === dataset[key] * 1) dataset[key] *= 1;
	return dataset;
}
function val(value) {
	if (typeof value === "undefined") {
		const el = this[0];
		if (!el) return void 0;
		if (el.multiple && el.nodeName.toLowerCase() === "select") {
			const values = [];
			for (let i = 0; i < el.selectedOptions.length; i += 1) values.push(el.selectedOptions[i].value);
			return values;
		}
		return el.value;
	}
	for (let i = 0; i < this.length; i += 1) {
		const el = this[i];
		if (Array.isArray(value) && el.multiple && el.nodeName.toLowerCase() === "select") for (let j = 0; j < el.options.length; j += 1) el.options[j].selected = value.indexOf(el.options[j].value) >= 0;
		else el.value = value;
	}
	return this;
}
function value(value) {
	return this.val(value);
}
function transform(transform) {
	for (let i = 0; i < this.length; i += 1) this[i].style.transform = transform;
	return this;
}
function transition(duration) {
	for (let i = 0; i < this.length; i += 1) this[i].style.transitionDuration = typeof duration !== "string" ? `${duration}ms` : duration;
	return this;
}
function on(...args) {
	let [eventType, targetSelector, listener, capture] = args;
	if (typeof args[1] === "function") {
		[eventType, listener, capture] = args;
		targetSelector = void 0;
	}
	if (!capture) capture = false;
	function handleLiveEvent(e) {
		const target = e.target;
		if (!target) return;
		const eventData = e.target.dom7EventData || [];
		if (eventData.indexOf(e) < 0) eventData.unshift(e);
		if ($(target).is(targetSelector)) listener.apply(target, eventData);
		else {
			const parents = $(target).parents();
			for (let k = 0; k < parents.length; k += 1) if ($(parents[k]).is(targetSelector)) listener.apply(parents[k], eventData);
		}
	}
	function handleEvent(e) {
		const eventData = e && e.target ? e.target.dom7EventData || [] : [];
		if (eventData.indexOf(e) < 0) eventData.unshift(e);
		listener.apply(this, eventData);
	}
	const events = eventType.split(" ");
	let j;
	for (let i = 0; i < this.length; i += 1) {
		const el = this[i];
		if (!targetSelector) for (j = 0; j < events.length; j += 1) {
			const event = events[j];
			if (!el.dom7Listeners) el.dom7Listeners = {};
			if (!el.dom7Listeners[event]) el.dom7Listeners[event] = [];
			el.dom7Listeners[event].push({
				listener,
				proxyListener: handleEvent
			});
			el.addEventListener(event, handleEvent, capture);
		}
		else for (j = 0; j < events.length; j += 1) {
			const event = events[j];
			if (!el.dom7LiveListeners) el.dom7LiveListeners = {};
			if (!el.dom7LiveListeners[event]) el.dom7LiveListeners[event] = [];
			el.dom7LiveListeners[event].push({
				listener,
				proxyListener: handleLiveEvent
			});
			el.addEventListener(event, handleLiveEvent, capture);
		}
	}
	return this;
}
function off(...args) {
	let [eventType, targetSelector, listener, capture] = args;
	if (typeof args[1] === "function") {
		[eventType, listener, capture] = args;
		targetSelector = void 0;
	}
	if (!capture) capture = false;
	const events = eventType.split(" ");
	for (let i = 0; i < events.length; i += 1) {
		const event = events[i];
		for (let j = 0; j < this.length; j += 1) {
			const el = this[j];
			let handlers;
			if (!targetSelector && el.dom7Listeners) handlers = el.dom7Listeners[event];
			else if (targetSelector && el.dom7LiveListeners) handlers = el.dom7LiveListeners[event];
			if (handlers && handlers.length) for (let k = handlers.length - 1; k >= 0; k -= 1) {
				const handler = handlers[k];
				if (listener && handler.listener === listener) {
					el.removeEventListener(event, handler.proxyListener, capture);
					handlers.splice(k, 1);
				} else if (listener && handler.listener && handler.listener.dom7proxy && handler.listener.dom7proxy === listener) {
					el.removeEventListener(event, handler.proxyListener, capture);
					handlers.splice(k, 1);
				} else if (!listener) {
					el.removeEventListener(event, handler.proxyListener, capture);
					handlers.splice(k, 1);
				}
			}
		}
	}
	return this;
}
function once$1(...args) {
	const dom = this;
	let [eventName, targetSelector, listener, capture] = args;
	if (typeof args[1] === "function") {
		[eventName, listener, capture] = args;
		targetSelector = void 0;
	}
	function onceHandler(...eventArgs) {
		listener.apply(this, eventArgs);
		dom.off(eventName, targetSelector, onceHandler, capture);
		if (onceHandler.dom7proxy) delete onceHandler.dom7proxy;
	}
	onceHandler.dom7proxy = listener;
	return dom.on(eventName, targetSelector, onceHandler, capture);
}
function trigger(...args) {
	const window = getWindow$1();
	const events = args[0].split(" ");
	const eventData = args[1];
	for (let i = 0; i < events.length; i += 1) {
		const event = events[i];
		for (let j = 0; j < this.length; j += 1) {
			const el = this[j];
			if (window.CustomEvent) {
				const evt = new window.CustomEvent(event, {
					detail: eventData,
					bubbles: true,
					cancelable: true
				});
				el.dom7EventData = args.filter((data, dataIndex) => dataIndex > 0);
				el.dispatchEvent(evt);
				el.dom7EventData = [];
				delete el.dom7EventData;
			}
		}
	}
	return this;
}
function transitionStart(callback) {
	const dom = this;
	function fireCallBack(e) {
		if (e.target !== this) return;
		callback.call(this, e);
		dom.off("transitionstart", fireCallBack);
	}
	if (callback) dom.on("transitionstart", fireCallBack);
	return this;
}
function transitionEnd(callback) {
	const dom = this;
	function fireCallBack(e) {
		if (e.target !== this) return;
		callback.call(this, e);
		dom.off("transitionend", fireCallBack);
	}
	if (callback) dom.on("transitionend", fireCallBack);
	return this;
}
function animationEnd(callback) {
	const dom = this;
	function fireCallBack(e) {
		if (e.target !== this) return;
		callback.call(this, e);
		dom.off("animationend", fireCallBack);
	}
	if (callback) dom.on("animationend", fireCallBack);
	return this;
}
function width() {
	const window = getWindow$1();
	if (this[0] === window) return window.innerWidth;
	if (this.length > 0) return parseFloat(this.css("width"));
	return null;
}
function outerWidth(includeMargins) {
	if (this.length > 0) {
		if (includeMargins) {
			const styles = this.styles();
			return this[0].offsetWidth + parseFloat(styles.getPropertyValue("margin-right")) + parseFloat(styles.getPropertyValue("margin-left"));
		}
		return this[0].offsetWidth;
	}
	return null;
}
function height() {
	const window = getWindow$1();
	if (this[0] === window) return window.innerHeight;
	if (this.length > 0) return parseFloat(this.css("height"));
	return null;
}
function outerHeight(includeMargins) {
	if (this.length > 0) {
		if (includeMargins) {
			const styles = this.styles();
			return this[0].offsetHeight + parseFloat(styles.getPropertyValue("margin-top")) + parseFloat(styles.getPropertyValue("margin-bottom"));
		}
		return this[0].offsetHeight;
	}
	return null;
}
function offset() {
	if (this.length > 0) {
		const window = getWindow$1();
		const document = getDocument$1();
		const el = this[0];
		const box = el.getBoundingClientRect();
		const body = document.body;
		const clientTop = el.clientTop || body.clientTop || 0;
		const clientLeft = el.clientLeft || body.clientLeft || 0;
		const scrollTop = el === window ? window.scrollY : el.scrollTop;
		const scrollLeft = el === window ? window.scrollX : el.scrollLeft;
		return {
			top: box.top + scrollTop - clientTop,
			left: box.left + scrollLeft - clientLeft
		};
	}
	return null;
}
function hide() {
	for (let i = 0; i < this.length; i += 1) this[i].style.display = "none";
	return this;
}
function show() {
	const window = getWindow$1();
	for (let i = 0; i < this.length; i += 1) {
		const el = this[i];
		if (el.style.display === "none") el.style.display = "";
		if (window.getComputedStyle(el, null).getPropertyValue("display") === "none") el.style.display = "block";
	}
	return this;
}
function styles() {
	const window = getWindow$1();
	if (this[0]) return window.getComputedStyle(this[0], null);
	return {};
}
function css(props, value) {
	const window = getWindow$1();
	let i;
	if (arguments.length === 1) {
		if (typeof props === "string") {
			if (this[0]) return window.getComputedStyle(this[0], null).getPropertyValue(props);
		} else {
			for (i = 0; i < this.length; i += 1) for (const prop in props) this[i].style[prop] = props[prop];
			return this;
		}
	}
	if (arguments.length === 2 && typeof props === "string") {
		for (i = 0; i < this.length; i += 1) this[i].style[props] = value;
		return this;
	}
	return this;
}
function each(callback) {
	if (!callback) return this;
	this.forEach((el, index) => {
		callback.apply(el, [el, index]);
	});
	return this;
}
function filter(callback) {
	return $(arrayFilter(this, callback));
}
function html(html) {
	if (typeof html === "undefined") return this[0] ? this[0].innerHTML : null;
	for (let i = 0; i < this.length; i += 1) this[i].innerHTML = html;
	return this;
}
function text(text) {
	if (typeof text === "undefined") return this[0] ? this[0].textContent.trim() : null;
	for (let i = 0; i < this.length; i += 1) this[i].textContent = text;
	return this;
}
function is(selector) {
	const window = getWindow$1();
	const document = getDocument$1();
	const el = this[0];
	let compareWith;
	let i;
	if (!el || typeof selector === "undefined") return false;
	if (typeof selector === "string") {
		if (el.matches) return el.matches(selector);
		if (el.webkitMatchesSelector) return el.webkitMatchesSelector(selector);
		if (el.msMatchesSelector) return el.msMatchesSelector(selector);
		compareWith = $(selector);
		for (i = 0; i < compareWith.length; i += 1) if (compareWith[i] === el) return true;
		return false;
	}
	if (selector === document) return el === document;
	if (selector === window) return el === window;
	if (selector.nodeType || selector instanceof Dom7) {
		compareWith = selector.nodeType ? [selector] : selector;
		for (i = 0; i < compareWith.length; i += 1) if (compareWith[i] === el) return true;
		return false;
	}
	return false;
}
function index() {
	let child = this[0];
	let i;
	if (child) {
		i = 0;
		while ((child = child.previousSibling) !== null) if (child.nodeType === 1) i += 1;
		return i;
	}
}
function eq(index) {
	if (typeof index === "undefined") return this;
	const length = this.length;
	if (index > length - 1) return $([]);
	if (index < 0) {
		const returnIndex = length + index;
		if (returnIndex < 0) return $([]);
		return $([this[returnIndex]]);
	}
	return $([this[index]]);
}
function append(...els) {
	let newChild;
	const document = getDocument$1();
	for (let k = 0; k < els.length; k += 1) {
		newChild = els[k];
		for (let i = 0; i < this.length; i += 1) if (typeof newChild === "string") {
			const tempDiv = document.createElement("div");
			tempDiv.innerHTML = newChild;
			while (tempDiv.firstChild) this[i].appendChild(tempDiv.firstChild);
		} else if (newChild instanceof Dom7) for (let j = 0; j < newChild.length; j += 1) this[i].appendChild(newChild[j]);
		else this[i].appendChild(newChild);
	}
	return this;
}
function appendTo(parent) {
	$(parent).append(this);
	return this;
}
function prepend(newChild) {
	const document = getDocument$1();
	let i;
	let j;
	for (i = 0; i < this.length; i += 1) if (typeof newChild === "string") {
		const tempDiv = document.createElement("div");
		tempDiv.innerHTML = newChild;
		for (j = tempDiv.childNodes.length - 1; j >= 0; j -= 1) this[i].insertBefore(tempDiv.childNodes[j], this[i].childNodes[0]);
	} else if (newChild instanceof Dom7) for (j = 0; j < newChild.length; j += 1) this[i].insertBefore(newChild[j], this[i].childNodes[0]);
	else this[i].insertBefore(newChild, this[i].childNodes[0]);
	return this;
}
function prependTo(parent) {
	$(parent).prepend(this);
	return this;
}
function insertBefore$1(selector) {
	const before = $(selector);
	for (let i = 0; i < this.length; i += 1) if (before.length === 1) before[0].parentNode.insertBefore(this[i], before[0]);
	else if (before.length > 1) for (let j = 0; j < before.length; j += 1) before[j].parentNode.insertBefore(this[i].cloneNode(true), before[j]);
}
function insertAfter(selector) {
	const after = $(selector);
	for (let i = 0; i < this.length; i += 1) if (after.length === 1) after[0].parentNode.insertBefore(this[i], after[0].nextSibling);
	else if (after.length > 1) for (let j = 0; j < after.length; j += 1) after[j].parentNode.insertBefore(this[i].cloneNode(true), after[j].nextSibling);
}
function next(selector) {
	if (this.length > 0) {
		if (selector) {
			if (this[0].nextElementSibling && $(this[0].nextElementSibling).is(selector)) return $([this[0].nextElementSibling]);
			return $([]);
		}
		if (this[0].nextElementSibling) return $([this[0].nextElementSibling]);
		return $([]);
	}
	return $([]);
}
function nextAll(selector) {
	const nextEls = [];
	let el = this[0];
	if (!el) return $([]);
	while (el.nextElementSibling) {
		const next = el.nextElementSibling;
		if (selector) {
			if ($(next).is(selector)) nextEls.push(next);
		} else nextEls.push(next);
		el = next;
	}
	return $(nextEls);
}
function prev(selector) {
	if (this.length > 0) {
		const el = this[0];
		if (selector) {
			if (el.previousElementSibling && $(el.previousElementSibling).is(selector)) return $([el.previousElementSibling]);
			return $([]);
		}
		if (el.previousElementSibling) return $([el.previousElementSibling]);
		return $([]);
	}
	return $([]);
}
function prevAll(selector) {
	const prevEls = [];
	let el = this[0];
	if (!el) return $([]);
	while (el.previousElementSibling) {
		const prev = el.previousElementSibling;
		if (selector) {
			if ($(prev).is(selector)) prevEls.push(prev);
		} else prevEls.push(prev);
		el = prev;
	}
	return $(prevEls);
}
function siblings(selector) {
	return this.nextAll(selector).add(this.prevAll(selector));
}
function parent(selector) {
	const parents = [];
	for (let i = 0; i < this.length; i += 1) if (this[i].parentNode !== null) {
		if (selector) {
			if ($(this[i].parentNode).is(selector)) parents.push(this[i].parentNode);
		} else parents.push(this[i].parentNode);
	}
	return $(parents);
}
function parents(selector) {
	const parents = [];
	for (let i = 0; i < this.length; i += 1) {
		let parent = this[i].parentNode;
		while (parent) {
			if (selector) {
				if ($(parent).is(selector)) parents.push(parent);
			} else parents.push(parent);
			parent = parent.parentNode;
		}
	}
	return $(parents);
}
function closest(selector) {
	let closest = this;
	if (typeof selector === "undefined") return $([]);
	if (!closest.is(selector)) closest = closest.parents(selector).eq(0);
	return closest;
}
function find(selector) {
	const foundElements = [];
	for (let i = 0; i < this.length; i += 1) {
		const found = this[i].querySelectorAll(selector);
		for (let j = 0; j < found.length; j += 1) foundElements.push(found[j]);
	}
	return $(foundElements);
}
function children$1(selector) {
	const children = [];
	for (let i = 0; i < this.length; i += 1) {
		const childNodes = this[i].children;
		for (let j = 0; j < childNodes.length; j += 1) if (!selector || $(childNodes[j]).is(selector)) children.push(childNodes[j]);
	}
	return $(children);
}
function remove() {
	for (let i = 0; i < this.length; i += 1) if (this[i].parentNode) this[i].parentNode.removeChild(this[i]);
	return this;
}
function detach() {
	return this.remove();
}
function add(...els) {
	const dom = this;
	let i;
	let j;
	for (i = 0; i < els.length; i += 1) {
		const toAdd = $(els[i]);
		for (j = 0; j < toAdd.length; j += 1) dom.push(toAdd[j]);
	}
	return dom;
}
function empty() {
	for (let i = 0; i < this.length; i += 1) {
		const el = this[i];
		if (el.nodeType === 1) {
			for (let j = 0; j < el.childNodes.length; j += 1) if (el.childNodes[j].parentNode) el.childNodes[j].parentNode.removeChild(el.childNodes[j]);
			el.textContent = "";
		}
	}
	return this;
}
function scrollTo(...args) {
	const window = getWindow$1();
	let [left, top, duration, easing, callback] = args;
	if (args.length === 4 && typeof easing === "function") {
		callback = easing;
		[left, top, duration, callback, easing] = args;
	}
	if (typeof easing === "undefined") easing = "swing";
	return this.each(function animate() {
		const el = this;
		let currentTop;
		let currentLeft;
		let maxTop;
		let maxLeft;
		let newTop;
		let newLeft;
		let scrollTop;
		let scrollLeft;
		let animateTop = top > 0 || top === 0;
		let animateLeft = left > 0 || left === 0;
		if (typeof easing === "undefined") easing = "swing";
		if (animateTop) {
			currentTop = el.scrollTop;
			if (!duration) el.scrollTop = top;
		}
		if (animateLeft) {
			currentLeft = el.scrollLeft;
			if (!duration) el.scrollLeft = left;
		}
		if (!duration) return;
		if (animateTop) {
			maxTop = el.scrollHeight - el.offsetHeight;
			newTop = Math.max(Math.min(top, maxTop), 0);
		}
		if (animateLeft) {
			maxLeft = el.scrollWidth - el.offsetWidth;
			newLeft = Math.max(Math.min(left, maxLeft), 0);
		}
		let startTime = null;
		if (animateTop && newTop === currentTop) animateTop = false;
		if (animateLeft && newLeft === currentLeft) animateLeft = false;
		function render(time = (/* @__PURE__ */ new Date()).getTime()) {
			if (startTime === null) startTime = time;
			const progress = Math.max(Math.min((time - startTime) / duration, 1), 0);
			const easeProgress = easing === "linear" ? progress : .5 - Math.cos(progress * Math.PI) / 2;
			let done;
			if (animateTop) scrollTop = currentTop + easeProgress * (newTop - currentTop);
			if (animateLeft) scrollLeft = currentLeft + easeProgress * (newLeft - currentLeft);
			if (animateTop && newTop > currentTop && scrollTop >= newTop) {
				el.scrollTop = newTop;
				done = true;
			}
			if (animateTop && newTop < currentTop && scrollTop <= newTop) {
				el.scrollTop = newTop;
				done = true;
			}
			if (animateLeft && newLeft > currentLeft && scrollLeft >= newLeft) {
				el.scrollLeft = newLeft;
				done = true;
			}
			if (animateLeft && newLeft < currentLeft && scrollLeft <= newLeft) {
				el.scrollLeft = newLeft;
				done = true;
			}
			if (done) {
				if (callback) callback();
				return;
			}
			if (animateTop) el.scrollTop = scrollTop;
			if (animateLeft) el.scrollLeft = scrollLeft;
			window.requestAnimationFrame(render);
		}
		window.requestAnimationFrame(render);
	});
}
function scrollTop(...args) {
	let [top, duration, easing, callback] = args;
	if (args.length === 3 && typeof easing === "function") [top, duration, callback, easing] = args;
	const dom = this;
	if (typeof top === "undefined") {
		if (dom.length > 0) return dom[0].scrollTop;
		return null;
	}
	return dom.scrollTo(void 0, top, duration, easing, callback);
}
function scrollLeft(...args) {
	let [left, duration, easing, callback] = args;
	if (args.length === 3 && typeof easing === "function") [left, duration, callback, easing] = args;
	const dom = this;
	if (typeof left === "undefined") {
		if (dom.length > 0) return dom[0].scrollLeft;
		return null;
	}
	return dom.scrollTo(left, void 0, duration, easing, callback);
}
function animate(initialProps, initialParams) {
	const window = getWindow$1();
	const els = this;
	const a = {
		props: Object.assign({}, initialProps),
		params: Object.assign({
			duration: 300,
			easing: "swing"
		}, initialParams),
		elements: els,
		animating: false,
		que: [],
		easingProgress(easing, progress) {
			if (easing === "swing") return .5 - Math.cos(progress * Math.PI) / 2;
			if (typeof easing === "function") return easing(progress);
			return progress;
		},
		stop() {
			if (a.frameId) window.cancelAnimationFrame(a.frameId);
			a.animating = false;
			a.elements.each((el) => {
				const element = el;
				delete element.dom7AnimateInstance;
			});
			a.que = [];
		},
		done(complete) {
			a.animating = false;
			a.elements.each((el) => {
				const element = el;
				delete element.dom7AnimateInstance;
			});
			if (complete) complete(els);
			if (a.que.length > 0) {
				const que = a.que.shift();
				a.animate(que[0], que[1]);
			}
		},
		animate(props, params) {
			if (a.animating) {
				a.que.push([props, params]);
				return a;
			}
			const elements = [];
			a.elements.each((el, index) => {
				let initialFullValue;
				let initialValue;
				let unit;
				let finalValue;
				let finalFullValue;
				if (!el.dom7AnimateInstance) a.elements[index].dom7AnimateInstance = a;
				elements[index] = { container: el };
				Object.keys(props).forEach((prop) => {
					initialFullValue = window.getComputedStyle(el, null).getPropertyValue(prop).replace(",", ".");
					initialValue = parseFloat(initialFullValue);
					unit = initialFullValue.replace(initialValue, "");
					finalValue = parseFloat(props[prop]);
					finalFullValue = props[prop] + unit;
					elements[index][prop] = {
						initialFullValue,
						initialValue,
						unit,
						finalValue,
						finalFullValue,
						currentValue: initialValue
					};
				});
			});
			let startTime = null;
			let time;
			let elementsDone = 0;
			let propsDone = 0;
			let done;
			let began = false;
			a.animating = true;
			function render() {
				time = (/* @__PURE__ */ new Date()).getTime();
				let progress;
				let easeProgress;
				if (!began) {
					began = true;
					if (params.begin) params.begin(els);
				}
				if (startTime === null) startTime = time;
				if (params.progress) params.progress(els, Math.max(Math.min((time - startTime) / params.duration, 1), 0), startTime + params.duration - time < 0 ? 0 : startTime + params.duration - time, startTime);
				elements.forEach((element) => {
					const el = element;
					if (done || el.done) return;
					Object.keys(props).forEach((prop) => {
						if (done || el.done) return;
						progress = Math.max(Math.min((time - startTime) / params.duration, 1), 0);
						easeProgress = a.easingProgress(params.easing, progress);
						const { initialValue, finalValue, unit } = el[prop];
						el[prop].currentValue = initialValue + easeProgress * (finalValue - initialValue);
						const currentValue = el[prop].currentValue;
						if (finalValue > initialValue && currentValue >= finalValue || finalValue < initialValue && currentValue <= finalValue) {
							el.container.style[prop] = finalValue + unit;
							propsDone += 1;
							if (propsDone === Object.keys(props).length) {
								el.done = true;
								elementsDone += 1;
							}
							if (elementsDone === elements.length) done = true;
						}
						if (done) {
							a.done(params.complete);
							return;
						}
						el.container.style[prop] = currentValue + unit;
					});
				});
				if (done) return;
				a.frameId = window.requestAnimationFrame(render);
			}
			a.frameId = window.requestAnimationFrame(render);
			return a;
		}
	};
	if (a.elements.length === 0) return els;
	let animateInstance;
	for (let i = 0; i < a.elements.length; i += 1) if (a.elements[i].dom7AnimateInstance) animateInstance = a.elements[i].dom7AnimateInstance;
	else a.elements[i].dom7AnimateInstance = a;
	if (!animateInstance) animateInstance = a;
	if (initialProps === "stop") animateInstance.stop();
	else animateInstance.animate(a.props, a.params);
	return els;
}
function stop() {
	const els = this;
	for (let i = 0; i < els.length; i += 1) if (els[i].dom7AnimateInstance) els[i].dom7AnimateInstance.stop();
}
var noTrigger = "resize scroll".split(" ");
function shortcut(name) {
	function eventHandler(...args) {
		if (typeof args[0] === "undefined") {
			for (let i = 0; i < this.length; i += 1) if (noTrigger.indexOf(name) < 0) {
				if (name in this[i]) this[i][name]();
				else $(this[i]).trigger(name);
			}
			return this;
		}
		return this.on(name, ...args);
	}
	return eventHandler;
}
var click = shortcut("click");
var blur = shortcut("blur");
var focus = shortcut("focus");
var focusin = shortcut("focusin");
var focusout = shortcut("focusout");
var keyup = shortcut("keyup");
var keydown = shortcut("keydown");
var keypress = shortcut("keypress");
var submit = shortcut("submit");
var change = shortcut("change");
var mousedown = shortcut("mousedown");
var mousemove = shortcut("mousemove");
var mouseup = shortcut("mouseup");
var mouseenter = shortcut("mouseenter");
var mouseleave = shortcut("mouseleave");
var mouseout = shortcut("mouseout");
var mouseover = shortcut("mouseover");
var touchstart = shortcut("touchstart");
var touchend = shortcut("touchend");
var touchmove = shortcut("touchmove");
var resize = shortcut("resize");
var scroll = shortcut("scroll");
Object.keys(dom7_esm_exports).forEach((methodName) => {
	if (methodName === "$") return;
	$.fn[methodName] = dom7_esm_exports[methodName];
});
var dom7_default = $;
/**
* SSR Window 5.0.1
* Better handling for window object in SSR environment
* https://github.com/nolimits4web/ssr-window
*
* Copyright 2025, Vladimir Kharlampidi
*
* Licensed under MIT
*
* Released on: June 27, 2025
*/
function isObject$2(obj) {
	return obj !== null && typeof obj === "object" && "constructor" in obj && obj.constructor === Object;
}
function extend$2(target = {}, src = {}) {
	const noExtend = [
		"__proto__",
		"constructor",
		"prototype"
	];
	Object.keys(src).filter((key) => noExtend.indexOf(key) < 0).forEach((key) => {
		if (typeof target[key] === "undefined") target[key] = src[key];
		else if (isObject$2(src[key]) && isObject$2(target[key]) && Object.keys(src[key]).length > 0) extend$2(target[key], src[key]);
	});
}
var ssrDocument = {
	body: {},
	addEventListener() {},
	removeEventListener() {},
	activeElement: {
		blur() {},
		nodeName: ""
	},
	querySelector() {
		return null;
	},
	querySelectorAll() {
		return [];
	},
	getElementById() {
		return null;
	},
	createEvent() {
		return { initEvent() {} };
	},
	createElement() {
		return {
			children: [],
			childNodes: [],
			style: {},
			setAttribute() {},
			getElementsByTagName() {
				return [];
			}
		};
	},
	createElementNS() {
		return {};
	},
	importNode() {
		return null;
	},
	location: {
		hash: "",
		host: "",
		hostname: "",
		href: "",
		origin: "",
		pathname: "",
		protocol: "",
		search: ""
	}
};
function getDocument() {
	const doc = typeof document !== "undefined" ? document : {};
	extend$2(doc, ssrDocument);
	return doc;
}
var ssrWindow = {
	document: ssrDocument,
	navigator: { userAgent: "" },
	location: {
		hash: "",
		host: "",
		hostname: "",
		href: "",
		origin: "",
		pathname: "",
		protocol: "",
		search: ""
	},
	history: {
		replaceState() {},
		pushState() {},
		go() {},
		back() {}
	},
	CustomEvent: function CustomEvent() {
		return this;
	},
	addEventListener() {},
	removeEventListener() {},
	getComputedStyle() {
		return { getPropertyValue() {
			return "";
		} };
	},
	Image() {},
	Date() {},
	screen: {},
	setTimeout() {},
	clearTimeout() {},
	matchMedia() {
		return {};
	},
	requestAnimationFrame(callback) {
		if (typeof setTimeout === "undefined") {
			callback();
			return null;
		}
		return setTimeout(callback, 0);
	},
	cancelAnimationFrame(id) {
		if (typeof setTimeout === "undefined") return;
		clearTimeout(id);
	}
};
function getWindow() {
	const win = typeof window !== "undefined" ? window : {};
	extend$2(win, ssrWindow);
	return win;
}
function signum(num) {
	return num < 0 ? -1 : 0 === num ? 0 : 1;
}
function lerp(start, stop, amount) {
	return (1 - amount) * start + amount * stop;
}
function clampInt(min, max, input) {
	return input < min ? min : input > max ? max : input;
}
function clampDouble(min, max, input) {
	return input < min ? min : input > max ? max : input;
}
function sanitizeDegreesInt(degrees) {
	return (degrees %= 360) < 0 && (degrees += 360), degrees;
}
function sanitizeDegreesDouble(degrees) {
	return (degrees %= 360) < 0 && (degrees += 360), degrees;
}
function matrixMultiply(row, matrix) {
	return [
		row[0] * matrix[0][0] + row[1] * matrix[0][1] + row[2] * matrix[0][2],
		row[0] * matrix[1][0] + row[1] * matrix[1][1] + row[2] * matrix[1][2],
		row[0] * matrix[2][0] + row[1] * matrix[2][1] + row[2] * matrix[2][2]
	];
}
var SRGB_TO_XYZ = [
	[
		.41233895,
		.35762064,
		.18051042
	],
	[
		.2126,
		.7152,
		.0722
	],
	[
		.01932141,
		.11916382,
		.95034478
	]
];
var XYZ_TO_SRGB = [
	[
		3.2413774792388685,
		-1.5376652402851851,
		-.49885366846268053
	],
	[
		-.9691452513005321,
		1.8758853451067872,
		.04156585616912061
	],
	[
		.05562093689691305,
		-.20395524564742123,
		1.0571799111220335
	]
];
var WHITE_POINT_D65 = [
	95.047,
	100,
	108.883
];
function argbFromRgb(red, green, blue) {
	return (255 << 24 | (255 & red) << 16 | (255 & green) << 8 | 255 & blue) >>> 0;
}
function argbFromLinrgb(linrgb) {
	return argbFromRgb(delinearized(linrgb[0]), delinearized(linrgb[1]), delinearized(linrgb[2]));
}
function redFromArgb(argb) {
	return argb >> 16 & 255;
}
function greenFromArgb(argb) {
	return argb >> 8 & 255;
}
function blueFromArgb(argb) {
	return 255 & argb;
}
function argbFromXyz(x, y, z) {
	const matrix = XYZ_TO_SRGB, linearR = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z, linearG = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z, linearB = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z;
	return argbFromRgb(delinearized(linearR), delinearized(linearG), delinearized(linearB));
}
function xyzFromArgb(argb) {
	return matrixMultiply([
		linearized(redFromArgb(argb)),
		linearized(greenFromArgb(argb)),
		linearized(blueFromArgb(argb))
	], SRGB_TO_XYZ);
}
function labFromArgb(argb) {
	const linearR = linearized(redFromArgb(argb)), linearG = linearized(greenFromArgb(argb)), linearB = linearized(blueFromArgb(argb)), matrix = SRGB_TO_XYZ, x = matrix[0][0] * linearR + matrix[0][1] * linearG + matrix[0][2] * linearB, y = matrix[1][0] * linearR + matrix[1][1] * linearG + matrix[1][2] * linearB, z = matrix[2][0] * linearR + matrix[2][1] * linearG + matrix[2][2] * linearB, yNormalized = y / WHITE_POINT_D65[1], zNormalized = z / WHITE_POINT_D65[2], fx = labF(x / WHITE_POINT_D65[0]), fy = labF(yNormalized);
	return [
		116 * fy - 16,
		500 * (fx - fy),
		200 * (fy - labF(zNormalized))
	];
}
function argbFromLstar(lstar) {
	const component = delinearized(yFromLstar(lstar));
	return argbFromRgb(component, component, component);
}
function lstarFromArgb(argb) {
	return 116 * labF(xyzFromArgb(argb)[1] / 100) - 16;
}
function yFromLstar(lstar) {
	return 100 * labInvf((lstar + 16) / 116);
}
function lstarFromY(y) {
	return 116 * labF(y / 100) - 16;
}
function linearized(rgbComponent) {
	const normalized = rgbComponent / 255;
	return normalized <= .040449936 ? normalized / 12.92 * 100 : 100 * Math.pow((normalized + .055) / 1.055, 2.4);
}
function delinearized(rgbComponent) {
	const normalized = rgbComponent / 100;
	let delinearized = 0;
	return delinearized = normalized <= .0031308 ? 12.92 * normalized : 1.055 * Math.pow(normalized, 1 / 2.4) - .055, clampInt(0, 255, Math.round(255 * delinearized));
}
function whitePointD65() {
	return WHITE_POINT_D65;
}
function labF(t) {
	return t > 216 / 24389 ? Math.pow(t, 1 / 3) : (903.2962962962963 * t + 16) / 116;
}
function labInvf(ft) {
	const ft3 = ft * ft * ft;
	return ft3 > 216 / 24389 ? ft3 : (116 * ft - 16) / 903.2962962962963;
}
var ViewingConditions = class ViewingConditions {
	static make(whitePoint = whitePointD65(), adaptingLuminance = 200 / Math.PI * yFromLstar(50) / 100, backgroundLstar = 50, surround = 2, discountingIlluminant = !1) {
		const xyz = whitePoint, rW = .401288 * xyz[0] + .650173 * xyz[1] + -.051461 * xyz[2], gW = -.250268 * xyz[0] + 1.204414 * xyz[1] + .045854 * xyz[2], bW = -.002079 * xyz[0] + .048952 * xyz[1] + .953127 * xyz[2], f = .8 + surround / 10, c = f >= .9 ? lerp(.59, .69, 10 * (f - .9)) : lerp(.525, .59, 10 * (f - .8));
		let d = discountingIlluminant ? 1 : f * (1 - 1 / 3.6 * Math.exp((-adaptingLuminance - 42) / 92));
		d = d > 1 ? 1 : d < 0 ? 0 : d;
		const nc = f, rgbD = [
			d * (100 / rW) + 1 - d,
			d * (100 / gW) + 1 - d,
			d * (100 / bW) + 1 - d
		], k = 1 / (5 * adaptingLuminance + 1), k4 = k * k * k * k, k4F = 1 - k4, fl = k4 * adaptingLuminance + .1 * k4F * k4F * Math.cbrt(5 * adaptingLuminance), n = yFromLstar(backgroundLstar) / whitePoint[1], z = 1.48 + Math.sqrt(n), nbb = .725 / Math.pow(n, .2), ncb = nbb, rgbAFactors = [
			Math.pow(fl * rgbD[0] * rW / 100, .42),
			Math.pow(fl * rgbD[1] * gW / 100, .42),
			Math.pow(fl * rgbD[2] * bW / 100, .42)
		], rgbA = [
			400 * rgbAFactors[0] / (rgbAFactors[0] + 27.13),
			400 * rgbAFactors[1] / (rgbAFactors[1] + 27.13),
			400 * rgbAFactors[2] / (rgbAFactors[2] + 27.13)
		];
		return new ViewingConditions(n, (2 * rgbA[0] + rgbA[1] + .05 * rgbA[2]) * nbb, nbb, ncb, c, nc, rgbD, fl, Math.pow(fl, .25), z);
	}
	constructor(n, aw, nbb, ncb, c, nc, rgbD, fl, fLRoot, z) {
		this.n = n, this.aw = aw, this.nbb = nbb, this.ncb = ncb, this.c = c, this.nc = nc, this.rgbD = rgbD, this.fl = fl, this.fLRoot = fLRoot, this.z = z;
	}
};
ViewingConditions.DEFAULT = ViewingConditions.make();
var Cam16 = class Cam16 {
	constructor(hue, chroma, j, q, m, s, jstar, astar, bstar) {
		this.hue = hue, this.chroma = chroma, this.j = j, this.q = q, this.m = m, this.s = s, this.jstar = jstar, this.astar = astar, this.bstar = bstar;
	}
	distance(other) {
		const dJ = this.jstar - other.jstar, dA = this.astar - other.astar, dB = this.bstar - other.bstar, dEPrime = Math.sqrt(dJ * dJ + dA * dA + dB * dB);
		return 1.41 * Math.pow(dEPrime, .63);
	}
	static fromInt(argb) {
		return Cam16.fromIntInViewingConditions(argb, ViewingConditions.DEFAULT);
	}
	static fromIntInViewingConditions(argb, viewingConditions) {
		const green = (65280 & argb) >> 8, blue = 255 & argb, redL = linearized((16711680 & argb) >> 16), greenL = linearized(green), blueL = linearized(blue), x = .41233895 * redL + .35762064 * greenL + .18051042 * blueL, y = .2126 * redL + .7152 * greenL + .0722 * blueL, z = .01932141 * redL + .11916382 * greenL + .95034478 * blueL, rC = .401288 * x + .650173 * y - .051461 * z, gC = -.250268 * x + 1.204414 * y + .045854 * z, bC = -.002079 * x + .048952 * y + .953127 * z, rD = viewingConditions.rgbD[0] * rC, gD = viewingConditions.rgbD[1] * gC, bD = viewingConditions.rgbD[2] * bC, rAF = Math.pow(viewingConditions.fl * Math.abs(rD) / 100, .42), gAF = Math.pow(viewingConditions.fl * Math.abs(gD) / 100, .42), bAF = Math.pow(viewingConditions.fl * Math.abs(bD) / 100, .42), rA = 400 * signum(rD) * rAF / (rAF + 27.13), gA = 400 * signum(gD) * gAF / (gAF + 27.13), bA = 400 * signum(bD) * bAF / (bAF + 27.13), a = (11 * rA + -12 * gA + bA) / 11, b = (rA + gA - 2 * bA) / 9, u = (20 * rA + 20 * gA + 21 * bA) / 20, p2 = (40 * rA + 20 * gA + bA) / 20, atanDegrees = 180 * Math.atan2(b, a) / Math.PI, hue = atanDegrees < 0 ? atanDegrees + 360 : atanDegrees >= 360 ? atanDegrees - 360 : atanDegrees, hueRadians = hue * Math.PI / 180, ac = p2 * viewingConditions.nbb, j = 100 * Math.pow(ac / viewingConditions.aw, viewingConditions.c * viewingConditions.z), q = 4 / viewingConditions.c * Math.sqrt(j / 100) * (viewingConditions.aw + 4) * viewingConditions.fLRoot, huePrime = hue < 20.14 ? hue + 360 : hue, t = 5e4 / 13 * (.25 * (Math.cos(huePrime * Math.PI / 180 + 2) + 3.8)) * viewingConditions.nc * viewingConditions.ncb * Math.sqrt(a * a + b * b) / (u + .305), alpha = Math.pow(t, .9) * Math.pow(1.64 - Math.pow(.29, viewingConditions.n), .73), c = alpha * Math.sqrt(j / 100), m = c * viewingConditions.fLRoot, s = 50 * Math.sqrt(alpha * viewingConditions.c / (viewingConditions.aw + 4)), jstar = (1 + 100 * .007) * j / (1 + .007 * j), mstar = 1 / .0228 * Math.log(1 + .0228 * m), astar = mstar * Math.cos(hueRadians), bstar = mstar * Math.sin(hueRadians);
		return new Cam16(hue, c, j, q, m, s, jstar, astar, bstar);
	}
	static fromJch(j, c, h) {
		return Cam16.fromJchInViewingConditions(j, c, h, ViewingConditions.DEFAULT);
	}
	static fromJchInViewingConditions(j, c, h, viewingConditions) {
		const q = 4 / viewingConditions.c * Math.sqrt(j / 100) * (viewingConditions.aw + 4) * viewingConditions.fLRoot, m = c * viewingConditions.fLRoot, alpha = c / Math.sqrt(j / 100), s = 50 * Math.sqrt(alpha * viewingConditions.c / (viewingConditions.aw + 4)), hueRadians = h * Math.PI / 180, jstar = (1 + 100 * .007) * j / (1 + .007 * j), mstar = 1 / .0228 * Math.log(1 + .0228 * m), astar = mstar * Math.cos(hueRadians), bstar = mstar * Math.sin(hueRadians);
		return new Cam16(h, c, j, q, m, s, jstar, astar, bstar);
	}
	static fromUcs(jstar, astar, bstar) {
		return Cam16.fromUcsInViewingConditions(jstar, astar, bstar, ViewingConditions.DEFAULT);
	}
	static fromUcsInViewingConditions(jstar, astar, bstar, viewingConditions) {
		const a = astar, b = bstar, m = Math.sqrt(a * a + b * b), c = (Math.exp(.0228 * m) - 1) / .0228 / viewingConditions.fLRoot;
		let h = Math.atan2(b, a) * (180 / Math.PI);
		h < 0 && (h += 360);
		const j = jstar / (1 - .007 * (jstar - 100));
		return Cam16.fromJchInViewingConditions(j, c, h, viewingConditions);
	}
	toInt() {
		return this.viewed(ViewingConditions.DEFAULT);
	}
	viewed(viewingConditions) {
		const alpha = 0 === this.chroma || 0 === this.j ? 0 : this.chroma / Math.sqrt(this.j / 100), t = Math.pow(alpha / Math.pow(1.64 - Math.pow(.29, viewingConditions.n), .73), 1 / .9), hRad = this.hue * Math.PI / 180, eHue = .25 * (Math.cos(hRad + 2) + 3.8), ac = viewingConditions.aw * Math.pow(this.j / 100, 1 / viewingConditions.c / viewingConditions.z), p1 = eHue * (5e4 / 13) * viewingConditions.nc * viewingConditions.ncb, p2 = ac / viewingConditions.nbb, hSin = Math.sin(hRad), hCos = Math.cos(hRad), gamma = 23 * (p2 + .305) * t / (23 * p1 + 11 * t * hCos + 108 * t * hSin), a = gamma * hCos, b = gamma * hSin, rA = (460 * p2 + 451 * a + 288 * b) / 1403, gA = (460 * p2 - 891 * a - 261 * b) / 1403, bA = (460 * p2 - 220 * a - 6300 * b) / 1403, rCBase = Math.max(0, 27.13 * Math.abs(rA) / (400 - Math.abs(rA))), rC = signum(rA) * (100 / viewingConditions.fl) * Math.pow(rCBase, 1 / .42), gCBase = Math.max(0, 27.13 * Math.abs(gA) / (400 - Math.abs(gA))), gC = signum(gA) * (100 / viewingConditions.fl) * Math.pow(gCBase, 1 / .42), bCBase = Math.max(0, 27.13 * Math.abs(bA) / (400 - Math.abs(bA))), bC = signum(bA) * (100 / viewingConditions.fl) * Math.pow(bCBase, 1 / .42), rF = rC / viewingConditions.rgbD[0], gF = gC / viewingConditions.rgbD[1], bF = bC / viewingConditions.rgbD[2];
		return argbFromXyz(1.86206786 * rF - 1.01125463 * gF + .14918677 * bF, .38752654 * rF + .62144744 * gF - .00897398 * bF, -.0158415 * rF - .03412294 * gF + 1.04996444 * bF);
	}
	static fromXyzInViewingConditions(x, y, z, viewingConditions) {
		const rC = .401288 * x + .650173 * y - .051461 * z, gC = -.250268 * x + 1.204414 * y + .045854 * z, bC = -.002079 * x + .048952 * y + .953127 * z, rD = viewingConditions.rgbD[0] * rC, gD = viewingConditions.rgbD[1] * gC, bD = viewingConditions.rgbD[2] * bC, rAF = Math.pow(viewingConditions.fl * Math.abs(rD) / 100, .42), gAF = Math.pow(viewingConditions.fl * Math.abs(gD) / 100, .42), bAF = Math.pow(viewingConditions.fl * Math.abs(bD) / 100, .42), rA = 400 * signum(rD) * rAF / (rAF + 27.13), gA = 400 * signum(gD) * gAF / (gAF + 27.13), bA = 400 * signum(bD) * bAF / (bAF + 27.13), a = (11 * rA + -12 * gA + bA) / 11, b = (rA + gA - 2 * bA) / 9, u = (20 * rA + 20 * gA + 21 * bA) / 20, p2 = (40 * rA + 20 * gA + bA) / 20, atanDegrees = 180 * Math.atan2(b, a) / Math.PI, hue = atanDegrees < 0 ? atanDegrees + 360 : atanDegrees >= 360 ? atanDegrees - 360 : atanDegrees, hueRadians = hue * Math.PI / 180, ac = p2 * viewingConditions.nbb, J = 100 * Math.pow(ac / viewingConditions.aw, viewingConditions.c * viewingConditions.z), Q = 4 / viewingConditions.c * Math.sqrt(J / 100) * (viewingConditions.aw + 4) * viewingConditions.fLRoot, huePrime = hue < 20.14 ? hue + 360 : hue, t = 5e4 / 13 * (1 / 4 * (Math.cos(huePrime * Math.PI / 180 + 2) + 3.8)) * viewingConditions.nc * viewingConditions.ncb * Math.sqrt(a * a + b * b) / (u + .305), alpha = Math.pow(t, .9) * Math.pow(1.64 - Math.pow(.29, viewingConditions.n), .73), C = alpha * Math.sqrt(J / 100), M = C * viewingConditions.fLRoot, s = 50 * Math.sqrt(alpha * viewingConditions.c / (viewingConditions.aw + 4)), jstar = (1 + 100 * .007) * J / (1 + .007 * J), mstar = Math.log(1 + .0228 * M) / .0228, astar = mstar * Math.cos(hueRadians), bstar = mstar * Math.sin(hueRadians);
		return new Cam16(hue, C, J, Q, M, s, jstar, astar, bstar);
	}
	xyzInViewingConditions(viewingConditions) {
		const alpha = 0 === this.chroma || 0 === this.j ? 0 : this.chroma / Math.sqrt(this.j / 100), t = Math.pow(alpha / Math.pow(1.64 - Math.pow(.29, viewingConditions.n), .73), 1 / .9), hRad = this.hue * Math.PI / 180, eHue = .25 * (Math.cos(hRad + 2) + 3.8), ac = viewingConditions.aw * Math.pow(this.j / 100, 1 / viewingConditions.c / viewingConditions.z), p1 = eHue * (5e4 / 13) * viewingConditions.nc * viewingConditions.ncb, p2 = ac / viewingConditions.nbb, hSin = Math.sin(hRad), hCos = Math.cos(hRad), gamma = 23 * (p2 + .305) * t / (23 * p1 + 11 * t * hCos + 108 * t * hSin), a = gamma * hCos, b = gamma * hSin, rA = (460 * p2 + 451 * a + 288 * b) / 1403, gA = (460 * p2 - 891 * a - 261 * b) / 1403, bA = (460 * p2 - 220 * a - 6300 * b) / 1403, rCBase = Math.max(0, 27.13 * Math.abs(rA) / (400 - Math.abs(rA))), rC = signum(rA) * (100 / viewingConditions.fl) * Math.pow(rCBase, 1 / .42), gCBase = Math.max(0, 27.13 * Math.abs(gA) / (400 - Math.abs(gA))), gC = signum(gA) * (100 / viewingConditions.fl) * Math.pow(gCBase, 1 / .42), bCBase = Math.max(0, 27.13 * Math.abs(bA) / (400 - Math.abs(bA))), bC = signum(bA) * (100 / viewingConditions.fl) * Math.pow(bCBase, 1 / .42), rF = rC / viewingConditions.rgbD[0], gF = gC / viewingConditions.rgbD[1], bF = bC / viewingConditions.rgbD[2];
		return [
			1.86206786 * rF - 1.01125463 * gF + .14918677 * bF,
			.38752654 * rF + .62144744 * gF - .00897398 * bF,
			-.0158415 * rF - .03412294 * gF + 1.04996444 * bF
		];
	}
};
var HctSolver = class HctSolver {
	static sanitizeRadians(angle) {
		return (angle + 8 * Math.PI) % (2 * Math.PI);
	}
	static trueDelinearized(rgbComponent) {
		const normalized = rgbComponent / 100;
		let delinearized = 0;
		return delinearized = normalized <= .0031308 ? 12.92 * normalized : 1.055 * Math.pow(normalized, 1 / 2.4) - .055, 255 * delinearized;
	}
	static chromaticAdaptation(component) {
		const af = Math.pow(Math.abs(component), .42);
		return 400 * signum(component) * af / (af + 27.13);
	}
	static hueOf(linrgb) {
		const scaledDiscount = matrixMultiply(linrgb, HctSolver.SCALED_DISCOUNT_FROM_LINRGB), rA = HctSolver.chromaticAdaptation(scaledDiscount[0]), gA = HctSolver.chromaticAdaptation(scaledDiscount[1]), bA = HctSolver.chromaticAdaptation(scaledDiscount[2]), a = (11 * rA + -12 * gA + bA) / 11, b = (rA + gA - 2 * bA) / 9;
		return Math.atan2(b, a);
	}
	static areInCyclicOrder(a, b, c) {
		return HctSolver.sanitizeRadians(b - a) < HctSolver.sanitizeRadians(c - a);
	}
	static intercept(source, mid, target) {
		return (mid - source) / (target - source);
	}
	static lerpPoint(source, t, target) {
		return [
			source[0] + (target[0] - source[0]) * t,
			source[1] + (target[1] - source[1]) * t,
			source[2] + (target[2] - source[2]) * t
		];
	}
	static setCoordinate(source, coordinate, target, axis) {
		const t = HctSolver.intercept(source[axis], coordinate, target[axis]);
		return HctSolver.lerpPoint(source, t, target);
	}
	static isBounded(x) {
		return 0 <= x && x <= 100;
	}
	static nthVertex(y, n) {
		const kR = HctSolver.Y_FROM_LINRGB[0], kG = HctSolver.Y_FROM_LINRGB[1], kB = HctSolver.Y_FROM_LINRGB[2], coordA = n % 4 <= 1 ? 0 : 100, coordB = n % 2 == 0 ? 0 : 100;
		if (n < 4) {
			const g = coordA, b = coordB, r = (y - g * kG - b * kB) / kR;
			return HctSolver.isBounded(r) ? [
				r,
				g,
				b
			] : [
				-1,
				-1,
				-1
			];
		}
		if (n < 8) {
			const b = coordA, r = coordB, g = (y - r * kR - b * kB) / kG;
			return HctSolver.isBounded(g) ? [
				r,
				g,
				b
			] : [
				-1,
				-1,
				-1
			];
		}
		{
			const r = coordA, g = coordB, b = (y - r * kR - g * kG) / kB;
			return HctSolver.isBounded(b) ? [
				r,
				g,
				b
			] : [
				-1,
				-1,
				-1
			];
		}
	}
	static bisectToSegment(y, targetHue) {
		let left = [
			-1,
			-1,
			-1
		], right = left, leftHue = 0, rightHue = 0, initialized = !1, uncut = !0;
		for (let n = 0; n < 12; n++) {
			const mid = HctSolver.nthVertex(y, n);
			if (mid[0] < 0) continue;
			const midHue = HctSolver.hueOf(mid);
			initialized ? (uncut || HctSolver.areInCyclicOrder(leftHue, midHue, rightHue)) && (uncut = !1, HctSolver.areInCyclicOrder(leftHue, targetHue, midHue) ? (right = mid, rightHue = midHue) : (left = mid, leftHue = midHue)) : (left = mid, right = mid, leftHue = midHue, rightHue = midHue, initialized = !0);
		}
		return [left, right];
	}
	static midpoint(a, b) {
		return [
			(a[0] + b[0]) / 2,
			(a[1] + b[1]) / 2,
			(a[2] + b[2]) / 2
		];
	}
	static criticalPlaneBelow(x) {
		return Math.floor(x - .5);
	}
	static criticalPlaneAbove(x) {
		return Math.ceil(x - .5);
	}
	static bisectToLimit(y, targetHue) {
		const segment = HctSolver.bisectToSegment(y, targetHue);
		let left = segment[0], leftHue = HctSolver.hueOf(left), right = segment[1];
		for (let axis = 0; axis < 3; axis++) if (left[axis] !== right[axis]) {
			let lPlane = -1, rPlane = 255;
			left[axis] < right[axis] ? (lPlane = HctSolver.criticalPlaneBelow(HctSolver.trueDelinearized(left[axis])), rPlane = HctSolver.criticalPlaneAbove(HctSolver.trueDelinearized(right[axis]))) : (lPlane = HctSolver.criticalPlaneAbove(HctSolver.trueDelinearized(left[axis])), rPlane = HctSolver.criticalPlaneBelow(HctSolver.trueDelinearized(right[axis])));
			for (let i = 0; i < 8 && !(Math.abs(rPlane - lPlane) <= 1); i++) {
				const mPlane = Math.floor((lPlane + rPlane) / 2), midPlaneCoordinate = HctSolver.CRITICAL_PLANES[mPlane], mid = HctSolver.setCoordinate(left, midPlaneCoordinate, right, axis), midHue = HctSolver.hueOf(mid);
				HctSolver.areInCyclicOrder(leftHue, targetHue, midHue) ? (right = mid, rPlane = mPlane) : (left = mid, leftHue = midHue, lPlane = mPlane);
			}
		}
		return HctSolver.midpoint(left, right);
	}
	static inverseChromaticAdaptation(adapted) {
		const adaptedAbs = Math.abs(adapted), base = Math.max(0, 27.13 * adaptedAbs / (400 - adaptedAbs));
		return signum(adapted) * Math.pow(base, 1 / .42);
	}
	static findResultByJ(hueRadians, chroma, y) {
		let j = 11 * Math.sqrt(y);
		const viewingConditions = ViewingConditions.DEFAULT, tInnerCoeff = 1 / Math.pow(1.64 - Math.pow(.29, viewingConditions.n), .73), p1 = .25 * (Math.cos(hueRadians + 2) + 3.8) * (5e4 / 13) * viewingConditions.nc * viewingConditions.ncb, hSin = Math.sin(hueRadians), hCos = Math.cos(hueRadians);
		for (let iterationRound = 0; iterationRound < 5; iterationRound++) {
			const jNormalized = j / 100, alpha = 0 === chroma || 0 === j ? 0 : chroma / Math.sqrt(jNormalized), t = Math.pow(alpha * tInnerCoeff, 1 / .9), p2 = viewingConditions.aw * Math.pow(jNormalized, 1 / viewingConditions.c / viewingConditions.z) / viewingConditions.nbb, gamma = 23 * (p2 + .305) * t / (23 * p1 + 11 * t * hCos + 108 * t * hSin), a = gamma * hCos, b = gamma * hSin, rA = (460 * p2 + 451 * a + 288 * b) / 1403, gA = (460 * p2 - 891 * a - 261 * b) / 1403, bA = (460 * p2 - 220 * a - 6300 * b) / 1403, linrgb = matrixMultiply([
				HctSolver.inverseChromaticAdaptation(rA),
				HctSolver.inverseChromaticAdaptation(gA),
				HctSolver.inverseChromaticAdaptation(bA)
			], HctSolver.LINRGB_FROM_SCALED_DISCOUNT);
			if (linrgb[0] < 0 || linrgb[1] < 0 || linrgb[2] < 0) return 0;
			const kR = HctSolver.Y_FROM_LINRGB[0], kG = HctSolver.Y_FROM_LINRGB[1], kB = HctSolver.Y_FROM_LINRGB[2], fnj = kR * linrgb[0] + kG * linrgb[1] + kB * linrgb[2];
			if (fnj <= 0) return 0;
			if (4 === iterationRound || Math.abs(fnj - y) < .002) return linrgb[0] > 100.01 || linrgb[1] > 100.01 || linrgb[2] > 100.01 ? 0 : argbFromLinrgb(linrgb);
			j -= (fnj - y) * j / (2 * fnj);
		}
		return 0;
	}
	static solveToInt(hueDegrees, chroma, lstar) {
		if (chroma < 1e-4 || lstar < 1e-4 || lstar > 99.9999) return argbFromLstar(lstar);
		const hueRadians = (hueDegrees = sanitizeDegreesDouble(hueDegrees)) / 180 * Math.PI, y = yFromLstar(lstar), exactAnswer = HctSolver.findResultByJ(hueRadians, chroma, y);
		if (0 !== exactAnswer) return exactAnswer;
		return argbFromLinrgb(HctSolver.bisectToLimit(y, hueRadians));
	}
	static solveToCam(hueDegrees, chroma, lstar) {
		return Cam16.fromInt(HctSolver.solveToInt(hueDegrees, chroma, lstar));
	}
};
HctSolver.SCALED_DISCOUNT_FROM_LINRGB = [
	[
		.001200833568784504,
		.002389694492170889,
		.0002795742885861124
	],
	[
		.0005891086651375999,
		.0029785502573438758,
		.0003270666104008398
	],
	[
		.00010146692491640572,
		.0005364214359186694,
		.0032979401770712076
	]
], HctSolver.LINRGB_FROM_SCALED_DISCOUNT = [
	[
		1373.2198709594231,
		-1100.4251190754821,
		-7.278681089101213
	],
	[
		-271.815969077903,
		559.6580465940733,
		-32.46047482791194
	],
	[
		1.9622899599665666,
		-57.173814538844006,
		308.7233197812385
	]
], HctSolver.Y_FROM_LINRGB = [
	.2126,
	.7152,
	.0722
], HctSolver.CRITICAL_PLANES = [
	.015176349177441876,
	.045529047532325624,
	.07588174588720938,
	.10623444424209313,
	.13658714259697685,
	.16693984095186062,
	.19729253930674434,
	.2276452376616281,
	.2579979360165119,
	.28835063437139563,
	.3188300904430532,
	.350925934958123,
	.3848314933096426,
	.42057480301049466,
	.458183274052838,
	.4976837250274023,
	.5391024159806381,
	.5824650784040898,
	.6277969426914107,
	.6751227633498623,
	.7244668422128921,
	.775853049866786,
	.829304845476233,
	.8848452951698498,
	.942497089126609,
	1.0022825574869039,
	1.0642236851973577,
	1.1283421258858297,
	1.1946592148522128,
	1.2631959812511864,
	1.3339731595349034,
	1.407011200216447,
	1.4823302800086415,
	1.5599503113873272,
	1.6398909516233677,
	1.7221716113234105,
	1.8068114625156377,
	1.8938294463134073,
	1.9832442801866852,
	2.075074464868551,
	2.1693382909216234,
	2.2660538449872063,
	2.36523901573795,
	2.4669114995532007,
	2.5710888059345764,
	2.6777882626779785,
	2.7870270208169257,
	2.898822059350997,
	3.0131901897720907,
	3.1301480604002863,
	3.2497121605402226,
	3.3718988244681087,
	3.4967242352587946,
	3.624204428461639,
	3.754355295633311,
	3.887192587735158,
	4.022731918402185,
	4.160988767090289,
	4.301978482107941,
	4.445716283538092,
	4.592217266055746,
	4.741496401646282,
	4.893568542229298,
	5.048448422192488,
	5.20615066083972,
	5.3666897647573375,
	5.5300801301023865,
	5.696336044816294,
	5.865471690767354,
	6.037501145825082,
	6.212438385869475,
	6.390297286737924,
	6.571091626112461,
	6.7548350853498045,
	6.941541251256611,
	7.131223617812143,
	7.323895587840543,
	7.5195704746346665,
	7.7182615035334345,
	7.919981813454504,
	8.124744458384042,
	8.332562408825165,
	8.543448553206703,
	8.757415699253682,
	8.974476575321063,
	9.194643831691977,
	9.417930041841839,
	9.644347703669503,
	9.873909240696694,
	10.106627003236781,
	10.342513269534024,
	10.58158024687427,
	10.8238400726681,
	11.069304815507364,
	11.317986476196008,
	11.569896988756009,
	11.825048221409341,
	12.083451977536606,
	12.345119996613247,
	12.610063955123938,
	12.878295467455942,
	13.149826086772048,
	13.42466730586372,
	13.702830557985108,
	13.984327217668513,
	14.269168601521828,
	14.55736596900856,
	14.848930523210871,
	15.143873411576273,
	15.44220572664832,
	15.743938506781891,
	16.04908273684337,
	16.35764934889634,
	16.66964922287304,
	16.985093187232053,
	17.30399201960269,
	17.62635644741625,
	17.95219714852476,
	18.281524751807332,
	18.614349837764564,
	18.95068293910138,
	19.290534541298456,
	19.633915083172692,
	19.98083495742689,
	20.331304511189067,
	20.685334046541502,
	21.042933821039977,
	21.404114048223256,
	21.76888489811322,
	22.137256497705877,
	22.50923893145328,
	22.884842241736916,
	23.264076429332462,
	23.6469514538663,
	24.033477234264016,
	24.42366364919083,
	24.817520537484558,
	25.21505769858089,
	25.61628489293138,
	26.021211842414342,
	26.429848230738664,
	26.842203703840827,
	27.258287870275353,
	27.678110301598522,
	28.10168053274597,
	28.529008062403893,
	28.96010235337422,
	29.39497283293396,
	29.83362889318845,
	30.276079891419332,
	30.722335150426627,
	31.172403958865512,
	31.62629557157785,
	32.08401920991837,
	32.54558406207592,
	33.010999283389665,
	33.4802739966603,
	33.953417292456834,
	34.430438229418264,
	34.911345834551085,
	35.39614910352207,
	35.88485700094671,
	36.37747846067349,
	36.87402238606382,
	37.37449765026789,
	37.87891309649659,
	38.38727753828926,
	38.89959975977785,
	39.41588851594697,
	39.93615253289054,
	40.460400508064545,
	40.98864111053629,
	41.520882981230194,
	42.05713473317016,
	42.597404951718396,
	43.141702194811224,
	43.6900349931913,
	44.24241185063697,
	44.798841244188324,
	45.35933162437017,
	45.92389141541209,
	46.49252901546552,
	47.065252796817916,
	47.64207110610409,
	48.22299226451468,
	48.808024568002054,
	49.3971762874833,
	49.9904556690408,
	50.587870934119984,
	51.189430279724725,
	51.79514187861014,
	52.40501387947288,
	53.0190544071392,
	53.637271562750364,
	54.259673423945976,
	54.88626804504493,
	55.517063457223934,
	56.15206766869424,
	56.79128866487574,
	57.43473440856916,
	58.08241284012621,
	58.734331877617365,
	59.39049941699807,
	60.05092333227251,
	60.715611475655585,
	61.38457167773311,
	62.057811747619894,
	62.7353394731159,
	63.417162620860914,
	64.10328893648692,
	64.79372614476921,
	65.48848194977529,
	66.18756403501224,
	66.89098006357258,
	67.59873767827808,
	68.31084450182222,
	69.02730813691093,
	69.74813616640164,
	70.47333615344107,
	71.20291564160104,
	71.93688215501312,
	72.67524319850172,
	73.41800625771542,
	74.16517879925733,
	74.9167682708136,
	75.67278210128072,
	76.43322770089146,
	77.1981124613393,
	77.96744375590167,
	78.74122893956174,
	79.51947534912904,
	80.30219030335869,
	81.08938110306934,
	81.88105503125999,
	82.67721935322541,
	83.4778813166706,
	84.28304815182372,
	85.09272707154808,
	85.90692527145302,
	86.72564993000343,
	87.54890820862819,
	88.3767072518277,
	89.2090541872801,
	90.04595612594655,
	90.88742016217518,
	91.73345337380438,
	92.58406282226491,
	93.43925555268066,
	94.29903859396902,
	95.16341895893969,
	96.03240364439274,
	96.9059996312159,
	97.78421388448044,
	98.6670533535366,
	99.55452497210776
];
var Hct = class Hct {
	static from(hue, chroma, tone) {
		return new Hct(HctSolver.solveToInt(hue, chroma, tone));
	}
	static fromInt(argb) {
		return new Hct(argb);
	}
	toInt() {
		return this.argb;
	}
	get hue() {
		return this.internalHue;
	}
	set hue(newHue) {
		this.setInternalState(HctSolver.solveToInt(newHue, this.internalChroma, this.internalTone));
	}
	get chroma() {
		return this.internalChroma;
	}
	set chroma(newChroma) {
		this.setInternalState(HctSolver.solveToInt(this.internalHue, newChroma, this.internalTone));
	}
	get tone() {
		return this.internalTone;
	}
	set tone(newTone) {
		this.setInternalState(HctSolver.solveToInt(this.internalHue, this.internalChroma, newTone));
	}
	setValue(propertyName, value) {
		this[propertyName] = value;
	}
	toString() {
		return `HCT(${this.hue.toFixed(0)}, ${this.chroma.toFixed(0)}, ${this.tone.toFixed(0)})`;
	}
	static isBlue(hue) {
		return hue >= 250 && hue < 270;
	}
	static isYellow(hue) {
		return hue >= 105 && hue < 125;
	}
	static isCyan(hue) {
		return hue >= 170 && hue < 207;
	}
	constructor(argb) {
		this.argb = argb;
		const cam = Cam16.fromInt(argb);
		this.internalHue = cam.hue, this.internalChroma = cam.chroma, this.internalTone = lstarFromArgb(argb), this.argb = argb;
	}
	setInternalState(argb) {
		const cam = Cam16.fromInt(argb);
		this.internalHue = cam.hue, this.internalChroma = cam.chroma, this.internalTone = lstarFromArgb(argb), this.argb = argb;
	}
	inViewingConditions(vc) {
		const viewedInVc = Cam16.fromInt(this.toInt()).xyzInViewingConditions(vc), recastInVc = Cam16.fromXyzInViewingConditions(viewedInVc[0], viewedInVc[1], viewedInVc[2], ViewingConditions.make());
		return Hct.from(recastInVc.hue, recastInVc.chroma, lstarFromY(viewedInVc[1]));
	}
};
var Contrast = class Contrast {
	static ratioOfTones(toneA, toneB) {
		return toneA = clampDouble(0, 100, toneA), toneB = clampDouble(0, 100, toneB), Contrast.ratioOfYs(yFromLstar(toneA), yFromLstar(toneB));
	}
	static ratioOfYs(y1, y2) {
		const lighter = y1 > y2 ? y1 : y2;
		return (lighter + 5) / ((lighter === y2 ? y1 : y2) + 5);
	}
	static lighter(tone, ratio) {
		if (tone < 0 || tone > 100) return -1;
		const darkY = yFromLstar(tone), lightY = ratio * (darkY + 5) - 5, realContrast = Contrast.ratioOfYs(lightY, darkY), delta = Math.abs(realContrast - ratio);
		if (realContrast < ratio && delta > .04) return -1;
		const returnValue = lstarFromY(lightY) + .4;
		return returnValue < 0 || returnValue > 100 ? -1 : returnValue;
	}
	static darker(tone, ratio) {
		if (tone < 0 || tone > 100) return -1;
		const lightY = yFromLstar(tone), darkY = (lightY + 5) / ratio - 5, realContrast = Contrast.ratioOfYs(lightY, darkY), delta = Math.abs(realContrast - ratio);
		if (realContrast < ratio && delta > .04) return -1;
		const returnValue = lstarFromY(darkY) - .4;
		return returnValue < 0 || returnValue > 100 ? -1 : returnValue;
	}
	static lighterUnsafe(tone, ratio) {
		const lighterSafe = Contrast.lighter(tone, ratio);
		return lighterSafe < 0 ? 100 : lighterSafe;
	}
	static darkerUnsafe(tone, ratio) {
		const darkerSafe = Contrast.darker(tone, ratio);
		return darkerSafe < 0 ? 0 : darkerSafe;
	}
};
var DislikeAnalyzer = class DislikeAnalyzer {
	static isDisliked(hct) {
		const huePasses = Math.round(hct.hue) >= 90 && Math.round(hct.hue) <= 111, chromaPasses = Math.round(hct.chroma) > 16, tonePasses = Math.round(hct.tone) < 65;
		return huePasses && chromaPasses && tonePasses;
	}
	static fixIfDisliked(hct) {
		return DislikeAnalyzer.isDisliked(hct) ? Hct.from(hct.hue, hct.chroma, 70) : hct;
	}
};
function validateExtendedColor(originalColor, specVersion, extendedColor) {
	if (originalColor.name !== extendedColor.name) throw new Error(`Attempting to extend color ${originalColor.name} with color ${extendedColor.name} of different name for spec version ${specVersion}.`);
	if (originalColor.isBackground !== extendedColor.isBackground) throw new Error(`Attempting to extend color ${originalColor.name} as a ${originalColor.isBackground ? "background" : "foreground"} with color ${extendedColor.name} as a ${extendedColor.isBackground ? "background" : "foreground"} for spec version ${specVersion}.`);
}
function extendSpecVersion(originlColor, specVersion, extendedColor) {
	return validateExtendedColor(originlColor, specVersion, extendedColor), DynamicColor.fromPalette({
		name: originlColor.name,
		palette: (s) => s.specVersion === specVersion ? extendedColor.palette(s) : originlColor.palette(s),
		tone: (s) => s.specVersion === specVersion ? extendedColor.tone(s) : originlColor.tone(s),
		isBackground: originlColor.isBackground,
		chromaMultiplier: (s) => {
			const chromaMultiplier = s.specVersion === specVersion ? extendedColor.chromaMultiplier : originlColor.chromaMultiplier;
			return void 0 !== chromaMultiplier ? chromaMultiplier(s) : 1;
		},
		background: (s) => {
			const background = s.specVersion === specVersion ? extendedColor.background : originlColor.background;
			return void 0 !== background ? background(s) : void 0;
		},
		secondBackground: (s) => {
			const secondBackground = s.specVersion === specVersion ? extendedColor.secondBackground : originlColor.secondBackground;
			return void 0 !== secondBackground ? secondBackground(s) : void 0;
		},
		contrastCurve: (s) => {
			const contrastCurve = s.specVersion === specVersion ? extendedColor.contrastCurve : originlColor.contrastCurve;
			return void 0 !== contrastCurve ? contrastCurve(s) : void 0;
		},
		toneDeltaPair: (s) => {
			const toneDeltaPair = s.specVersion === specVersion ? extendedColor.toneDeltaPair : originlColor.toneDeltaPair;
			return void 0 !== toneDeltaPair ? toneDeltaPair(s) : void 0;
		}
	});
}
var DynamicColor = class DynamicColor {
	static fromPalette(args) {
		return new DynamicColor(args.name ?? "", args.palette, args.tone ?? DynamicColor.getInitialToneFromBackground(args.background), args.isBackground ?? !1, args.chromaMultiplier, args.background, args.secondBackground, args.contrastCurve, args.toneDeltaPair);
	}
	static getInitialToneFromBackground(background) {
		return void 0 === background ? (s) => 50 : (s) => background(s) ? background(s).getTone(s) : 50;
	}
	constructor(name, palette, tone, isBackground, chromaMultiplier, background, secondBackground, contrastCurve, toneDeltaPair) {
		if (this.name = name, this.palette = palette, this.tone = tone, this.isBackground = isBackground, this.chromaMultiplier = chromaMultiplier, this.background = background, this.secondBackground = secondBackground, this.contrastCurve = contrastCurve, this.toneDeltaPair = toneDeltaPair, this.hctCache = /* @__PURE__ */ new Map(), !background && secondBackground) throw new Error(`Color ${name} has secondBackgrounddefined, but background is not defined.`);
		if (!background && contrastCurve) throw new Error(`Color ${name} has contrastCurvedefined, but background is not defined.`);
		if (background && !contrastCurve) throw new Error(`Color ${name} has backgrounddefined, but contrastCurve is not defined.`);
	}
	clone() {
		return DynamicColor.fromPalette({
			name: this.name,
			palette: this.palette,
			tone: this.tone,
			isBackground: this.isBackground,
			chromaMultiplier: this.chromaMultiplier,
			background: this.background,
			secondBackground: this.secondBackground,
			contrastCurve: this.contrastCurve,
			toneDeltaPair: this.toneDeltaPair
		});
	}
	clearCache() {
		this.hctCache.clear();
	}
	getArgb(scheme) {
		return this.getHct(scheme).toInt();
	}
	getHct(scheme) {
		const cachedAnswer = this.hctCache.get(scheme);
		if (null != cachedAnswer) return cachedAnswer;
		const answer = getSpec$1(scheme.specVersion).getHct(scheme, this);
		return this.hctCache.size > 4 && this.hctCache.clear(), this.hctCache.set(scheme, answer), answer;
	}
	getTone(scheme) {
		return getSpec$1(scheme.specVersion).getTone(scheme, this);
	}
	static foregroundTone(bgTone, ratio) {
		const lighterTone = Contrast.lighterUnsafe(bgTone, ratio), darkerTone = Contrast.darkerUnsafe(bgTone, ratio), lighterRatio = Contrast.ratioOfTones(lighterTone, bgTone), darkerRatio = Contrast.ratioOfTones(darkerTone, bgTone);
		if (DynamicColor.tonePrefersLightForeground(bgTone)) {
			const negligibleDifference = Math.abs(lighterRatio - darkerRatio) < .1 && lighterRatio < ratio && darkerRatio < ratio;
			return lighterRatio >= ratio || lighterRatio >= darkerRatio || negligibleDifference ? lighterTone : darkerTone;
		}
		return darkerRatio >= ratio || darkerRatio >= lighterRatio ? darkerTone : lighterTone;
	}
	static tonePrefersLightForeground(tone) {
		return Math.round(tone) < 60;
	}
	static toneAllowsLightForeground(tone) {
		return Math.round(tone) <= 49;
	}
	static enableLightForeground(tone) {
		return DynamicColor.tonePrefersLightForeground(tone) && !DynamicColor.toneAllowsLightForeground(tone) ? 49 : tone;
	}
};
var ColorCalculationDelegateImpl2021 = class {
	getHct(scheme, color) {
		const tone = color.getTone(scheme);
		return color.palette(scheme).getHct(tone);
	}
	getTone(scheme, color) {
		const decreasingContrast = scheme.contrastLevel < 0, toneDeltaPair = color.toneDeltaPair ? color.toneDeltaPair(scheme) : void 0;
		if (toneDeltaPair) {
			const roleA = toneDeltaPair.roleA, roleB = toneDeltaPair.roleB, delta = toneDeltaPair.delta, polarity = toneDeltaPair.polarity, stayTogether = toneDeltaPair.stayTogether, aIsNearer = "nearer" === polarity || "lighter" === polarity && !scheme.isDark || "darker" === polarity && scheme.isDark, nearer = aIsNearer ? roleA : roleB, farther = aIsNearer ? roleB : roleA, amNearer = color.name === nearer.name, expansionDir = scheme.isDark ? 1 : -1;
			let nTone = nearer.tone(scheme), fTone = farther.tone(scheme);
			if (color.background && nearer.contrastCurve && farther.contrastCurve) {
				const bg = color.background(scheme), nContrastCurve = nearer.contrastCurve(scheme), fContrastCurve = farther.contrastCurve(scheme);
				if (bg && nContrastCurve && fContrastCurve) {
					const bgTone = bg.getTone(scheme), nContrast = nContrastCurve.get(scheme.contrastLevel), fContrast = fContrastCurve.get(scheme.contrastLevel);
					Contrast.ratioOfTones(bgTone, nTone) < nContrast && (nTone = DynamicColor.foregroundTone(bgTone, nContrast)), Contrast.ratioOfTones(bgTone, fTone) < fContrast && (fTone = DynamicColor.foregroundTone(bgTone, fContrast)), decreasingContrast && (nTone = DynamicColor.foregroundTone(bgTone, nContrast), fTone = DynamicColor.foregroundTone(bgTone, fContrast));
				}
			}
			return (fTone - nTone) * expansionDir < delta && (fTone = clampDouble(0, 100, nTone + delta * expansionDir), (fTone - nTone) * expansionDir >= delta || (nTone = clampDouble(0, 100, fTone - delta * expansionDir))), 50 <= nTone && nTone < 60 ? expansionDir > 0 ? (nTone = 60, fTone = Math.max(fTone, nTone + delta * expansionDir)) : (nTone = 49, fTone = Math.min(fTone, nTone + delta * expansionDir)) : 50 <= fTone && fTone < 60 && (stayTogether ? expansionDir > 0 ? (nTone = 60, fTone = Math.max(fTone, nTone + delta * expansionDir)) : (nTone = 49, fTone = Math.min(fTone, nTone + delta * expansionDir)) : fTone = expansionDir > 0 ? 60 : 49), amNearer ? nTone : fTone;
		}
		{
			let answer = color.tone(scheme);
			if (null == color.background || void 0 === color.background(scheme) || null == color.contrastCurve || void 0 === color.contrastCurve(scheme)) return answer;
			const bgTone = color.background(scheme).getTone(scheme), desiredRatio = color.contrastCurve(scheme).get(scheme.contrastLevel);
			if (Contrast.ratioOfTones(bgTone, answer) >= desiredRatio || (answer = DynamicColor.foregroundTone(bgTone, desiredRatio)), decreasingContrast && (answer = DynamicColor.foregroundTone(bgTone, desiredRatio)), color.isBackground && 50 <= answer && answer < 60 && (answer = Contrast.ratioOfTones(49, bgTone) >= desiredRatio ? 49 : 60), null == color.secondBackground || void 0 === color.secondBackground(scheme)) return answer;
			const [bg1, bg2] = [color.background, color.secondBackground], [bgTone1, bgTone2] = [bg1(scheme).getTone(scheme), bg2(scheme).getTone(scheme)], [upper, lower] = [Math.max(bgTone1, bgTone2), Math.min(bgTone1, bgTone2)];
			if (Contrast.ratioOfTones(upper, answer) >= desiredRatio && Contrast.ratioOfTones(lower, answer) >= desiredRatio) return answer;
			const lightOption = Contrast.lighter(upper, desiredRatio), darkOption = Contrast.darker(lower, desiredRatio), availables = [];
			-1 !== lightOption && availables.push(lightOption), -1 !== darkOption && availables.push(darkOption);
			return DynamicColor.tonePrefersLightForeground(bgTone1) || DynamicColor.tonePrefersLightForeground(bgTone2) ? lightOption < 0 ? 100 : lightOption : 1 === availables.length ? availables[0] : darkOption < 0 ? 0 : darkOption;
		}
	}
};
var ColorCalculationDelegateImpl2025 = class {
	getHct(scheme, color) {
		const palette = color.palette(scheme), tone = color.getTone(scheme), hue = palette.hue, chroma = palette.chroma * (color.chromaMultiplier ? color.chromaMultiplier(scheme) : 1);
		return Hct.from(hue, chroma, tone);
	}
	getTone(scheme, color) {
		const toneDeltaPair = color.toneDeltaPair ? color.toneDeltaPair(scheme) : void 0;
		if (toneDeltaPair) {
			const roleA = toneDeltaPair.roleA, roleB = toneDeltaPair.roleB, polarity = toneDeltaPair.polarity, constraint = toneDeltaPair.constraint, absoluteDelta = "darker" === polarity || "relative_lighter" === polarity && scheme.isDark || "relative_darker" === polarity && !scheme.isDark ? -toneDeltaPair.delta : toneDeltaPair.delta, amRoleA = color.name === roleA.name, refRole = amRoleA ? roleB : roleA;
			let selfTone = (amRoleA ? roleA : roleB).tone(scheme), refTone = refRole.getTone(scheme);
			const relativeDelta = absoluteDelta * (amRoleA ? 1 : -1);
			if ("exact" === constraint ? selfTone = clampDouble(0, 100, refTone + relativeDelta) : "nearer" === constraint ? selfTone = clampDouble(0, 100, relativeDelta > 0 ? clampDouble(refTone, refTone + relativeDelta, selfTone) : clampDouble(refTone + relativeDelta, refTone, selfTone)) : "farther" === constraint && (selfTone = relativeDelta > 0 ? clampDouble(refTone + relativeDelta, 100, selfTone) : clampDouble(0, refTone + relativeDelta, selfTone)), color.background && color.contrastCurve) {
				const background = color.background(scheme), contrastCurve = color.contrastCurve(scheme);
				if (background && contrastCurve) {
					const bgTone = background.getTone(scheme), selfContrast = contrastCurve.get(scheme.contrastLevel);
					selfTone = Contrast.ratioOfTones(bgTone, selfTone) >= selfContrast && scheme.contrastLevel >= 0 ? selfTone : DynamicColor.foregroundTone(bgTone, selfContrast);
				}
			}
			return color.isBackground && !color.name.endsWith("_fixed_dim") && (selfTone = selfTone >= 57 ? clampDouble(65, 100, selfTone) : clampDouble(0, 49, selfTone)), selfTone;
		}
		{
			let answer = color.tone(scheme);
			if (null == color.background || void 0 === color.background(scheme) || null == color.contrastCurve || void 0 === color.contrastCurve(scheme)) return answer;
			const bgTone = color.background(scheme).getTone(scheme), desiredRatio = color.contrastCurve(scheme).get(scheme.contrastLevel);
			if (answer = Contrast.ratioOfTones(bgTone, answer) >= desiredRatio && scheme.contrastLevel >= 0 ? answer : DynamicColor.foregroundTone(bgTone, desiredRatio), color.isBackground && !color.name.endsWith("_fixed_dim") && (answer = answer >= 57 ? clampDouble(65, 100, answer) : clampDouble(0, 49, answer)), null == color.secondBackground || void 0 === color.secondBackground(scheme)) return answer;
			const [bg1, bg2] = [color.background, color.secondBackground], [bgTone1, bgTone2] = [bg1(scheme).getTone(scheme), bg2(scheme).getTone(scheme)], [upper, lower] = [Math.max(bgTone1, bgTone2), Math.min(bgTone1, bgTone2)];
			if (Contrast.ratioOfTones(upper, answer) >= desiredRatio && Contrast.ratioOfTones(lower, answer) >= desiredRatio) return answer;
			const lightOption = Contrast.lighter(upper, desiredRatio), darkOption = Contrast.darker(lower, desiredRatio), availables = [];
			-1 !== lightOption && availables.push(lightOption), -1 !== darkOption && availables.push(darkOption);
			return DynamicColor.tonePrefersLightForeground(bgTone1) || DynamicColor.tonePrefersLightForeground(bgTone2) ? lightOption < 0 ? 100 : lightOption : 1 === availables.length ? availables[0] : darkOption < 0 ? 0 : darkOption;
		}
	}
};
var spec2021$1 = new ColorCalculationDelegateImpl2021();
var spec2025$1 = new ColorCalculationDelegateImpl2025();
function getSpec$1(specVersion) {
	return "2025" === specVersion ? spec2025$1 : spec2021$1;
}
var TonalPalette = class TonalPalette {
	static fromInt(argb) {
		const hct = Hct.fromInt(argb);
		return TonalPalette.fromHct(hct);
	}
	static fromHct(hct) {
		return new TonalPalette(hct.hue, hct.chroma, hct);
	}
	static fromHueAndChroma(hue, chroma) {
		const keyColor = new KeyColor(hue, chroma).create();
		return new TonalPalette(hue, chroma, keyColor);
	}
	constructor(hue, chroma, keyColor) {
		this.hue = hue, this.chroma = chroma, this.keyColor = keyColor, this.cache = /* @__PURE__ */ new Map();
	}
	tone(tone) {
		let argb = this.cache.get(tone);
		return void 0 === argb && (argb = 99 == tone && Hct.isYellow(this.hue) ? this.averageArgb(this.tone(98), this.tone(100)) : Hct.from(this.hue, this.chroma, tone).toInt(), this.cache.set(tone, argb)), argb;
	}
	getHct(tone) {
		return Hct.fromInt(this.tone(tone));
	}
	averageArgb(argb1, argb2) {
		const red1 = argb1 >>> 16 & 255, green1 = argb1 >>> 8 & 255, blue1 = 255 & argb1, red2 = argb2 >>> 16 & 255, green2 = argb2 >>> 8 & 255, blue2 = 255 & argb2;
		return (255 << 24 | (255 & Math.round((red1 + red2) / 2)) << 16 | (255 & Math.round((green1 + green2) / 2)) << 8 | 255 & Math.round((blue1 + blue2) / 2)) >>> 0;
	}
};
var KeyColor = class {
	constructor(hue, requestedChroma) {
		this.hue = hue, this.requestedChroma = requestedChroma, this.chromaCache = /* @__PURE__ */ new Map(), this.maxChromaValue = 200;
	}
	create() {
		let lowerTone = 0, upperTone = 100;
		for (; lowerTone < upperTone;) {
			const midTone = Math.floor((lowerTone + upperTone) / 2), isAscending = this.maxChroma(midTone) < this.maxChroma(midTone + 1);
			if (this.maxChroma(midTone) >= this.requestedChroma - .01) {
				if (Math.abs(lowerTone - 50) < Math.abs(upperTone - 50)) upperTone = midTone;
				else {
					if (lowerTone === midTone) return Hct.from(this.hue, this.requestedChroma, lowerTone);
					lowerTone = midTone;
				}
			} else isAscending ? lowerTone = midTone + 1 : upperTone = midTone;
		}
		return Hct.from(this.hue, this.requestedChroma, lowerTone);
	}
	maxChroma(tone) {
		if (this.chromaCache.has(tone)) return this.chromaCache.get(tone);
		const chroma = Hct.from(this.hue, this.maxChromaValue, tone).chroma;
		return this.chromaCache.set(tone, chroma), chroma;
	}
};
var TemperatureCache = class TemperatureCache {
	constructor(input) {
		this.input = input, this.hctsByTempCache = [], this.hctsByHueCache = [], this.tempsByHctCache = /* @__PURE__ */ new Map(), this.inputRelativeTemperatureCache = -1, this.complementCache = null;
	}
	get hctsByTemp() {
		if (this.hctsByTempCache.length > 0) return this.hctsByTempCache;
		const hcts = this.hctsByHue.concat([this.input]), temperaturesByHct = this.tempsByHct;
		return hcts.sort((a, b) => temperaturesByHct.get(a) - temperaturesByHct.get(b)), this.hctsByTempCache = hcts, hcts;
	}
	get warmest() {
		return this.hctsByTemp[this.hctsByTemp.length - 1];
	}
	get coldest() {
		return this.hctsByTemp[0];
	}
	analogous(count = 5, divisions = 12) {
		const startHue = Math.round(this.input.hue), startHct = this.hctsByHue[startHue];
		let lastTemp = this.relativeTemperature(startHct);
		const allColors = [startHct];
		let absoluteTotalTempDelta = 0;
		for (let i = 0; i < 360; i++) {
			const hue = sanitizeDegreesInt(startHue + i), hct = this.hctsByHue[hue], temp = this.relativeTemperature(hct), tempDelta = Math.abs(temp - lastTemp);
			lastTemp = temp, absoluteTotalTempDelta += tempDelta;
		}
		let hueAddend = 1;
		const tempStep = absoluteTotalTempDelta / divisions;
		let totalTempDelta = 0;
		for (lastTemp = this.relativeTemperature(startHct); allColors.length < divisions;) {
			const hue = sanitizeDegreesInt(startHue + hueAddend), hct = this.hctsByHue[hue], temp = this.relativeTemperature(hct);
			totalTempDelta += Math.abs(temp - lastTemp);
			let indexSatisfied = totalTempDelta >= allColors.length * tempStep, indexAddend = 1;
			for (; indexSatisfied && allColors.length < divisions;) {
				allColors.push(hct);
				indexSatisfied = totalTempDelta >= (allColors.length + indexAddend) * tempStep, indexAddend++;
			}
			if (lastTemp = temp, hueAddend++, hueAddend > 360) {
				for (; allColors.length < divisions;) allColors.push(hct);
				break;
			}
		}
		const answers = [this.input], increaseHueCount = Math.floor((count - 1) / 2);
		for (let i = 1; i < increaseHueCount + 1; i++) {
			let index = 0 - i;
			for (; index < 0;) index = allColors.length + index;
			index >= allColors.length && (index %= allColors.length), answers.splice(0, 0, allColors[index]);
		}
		const decreaseHueCount = count - increaseHueCount - 1;
		for (let i = 1; i < decreaseHueCount + 1; i++) {
			let index = i;
			for (; index < 0;) index = allColors.length + index;
			index >= allColors.length && (index %= allColors.length), answers.push(allColors[index]);
		}
		return answers;
	}
	get complement() {
		if (null != this.complementCache) return this.complementCache;
		const coldestHue = this.coldest.hue, coldestTemp = this.tempsByHct.get(this.coldest), warmestHue = this.warmest.hue, range = this.tempsByHct.get(this.warmest) - coldestTemp, startHueIsColdestToWarmest = TemperatureCache.isBetween(this.input.hue, coldestHue, warmestHue), startHue = startHueIsColdestToWarmest ? warmestHue : coldestHue, endHue = startHueIsColdestToWarmest ? coldestHue : warmestHue;
		let smallestError = 1e3, answer = this.hctsByHue[Math.round(this.input.hue)];
		const complementRelativeTemp = 1 - this.inputRelativeTemperature;
		for (let hueAddend = 0; hueAddend <= 360; hueAddend += 1) {
			const hue = sanitizeDegreesDouble(startHue + 1 * hueAddend);
			if (!TemperatureCache.isBetween(hue, startHue, endHue)) continue;
			const possibleAnswer = this.hctsByHue[Math.round(hue)], relativeTemp = (this.tempsByHct.get(possibleAnswer) - coldestTemp) / range, error = Math.abs(complementRelativeTemp - relativeTemp);
			error < smallestError && (smallestError = error, answer = possibleAnswer);
		}
		return this.complementCache = answer, this.complementCache;
	}
	relativeTemperature(hct) {
		const range = this.tempsByHct.get(this.warmest) - this.tempsByHct.get(this.coldest), differenceFromColdest = this.tempsByHct.get(hct) - this.tempsByHct.get(this.coldest);
		return 0 === range ? .5 : differenceFromColdest / range;
	}
	get inputRelativeTemperature() {
		return this.inputRelativeTemperatureCache >= 0 || (this.inputRelativeTemperatureCache = this.relativeTemperature(this.input)), this.inputRelativeTemperatureCache;
	}
	get tempsByHct() {
		if (this.tempsByHctCache.size > 0) return this.tempsByHctCache;
		const allHcts = this.hctsByHue.concat([this.input]), temperaturesByHct = /* @__PURE__ */ new Map();
		for (const e of allHcts) temperaturesByHct.set(e, TemperatureCache.rawTemperature(e));
		return this.tempsByHctCache = temperaturesByHct, temperaturesByHct;
	}
	get hctsByHue() {
		if (this.hctsByHueCache.length > 0) return this.hctsByHueCache;
		const hcts = [];
		for (let hue = 0; hue <= 360; hue += 1) {
			const colorAtHue = Hct.from(hue, this.input.chroma, this.input.tone);
			hcts.push(colorAtHue);
		}
		return this.hctsByHueCache = hcts, this.hctsByHueCache;
	}
	static isBetween(angle, a, b) {
		return a < b ? a <= angle && angle <= b : a <= angle || angle <= b;
	}
	static rawTemperature(color) {
		const lab = labFromArgb(color.toInt()), hue = sanitizeDegreesDouble(180 * Math.atan2(lab[2], lab[1]) / Math.PI), chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
		return .02 * Math.pow(chroma, 1.07) * Math.cos(sanitizeDegreesDouble(hue - 50) * Math.PI / 180) - .5;
	}
};
var ContrastCurve = class {
	constructor(low, normal, medium, high) {
		this.low = low, this.normal = normal, this.medium = medium, this.high = high;
	}
	get(contrastLevel) {
		return contrastLevel <= -1 ? this.low : contrastLevel < 0 ? lerp(this.low, this.normal, (contrastLevel - -1) / 1) : contrastLevel < .5 ? lerp(this.normal, this.medium, (contrastLevel - 0) / .5) : contrastLevel < 1 ? lerp(this.medium, this.high, (contrastLevel - .5) / .5) : this.high;
	}
};
var ToneDeltaPair = class {
	constructor(roleA, roleB, delta, polarity, stayTogether, constraint) {
		this.roleA = roleA, this.roleB = roleB, this.delta = delta, this.polarity = polarity, this.stayTogether = stayTogether, this.constraint = constraint, this.constraint = constraint ?? "exact";
	}
};
var Variant;
function isFidelity(scheme) {
	return scheme.variant === Variant.FIDELITY || scheme.variant === Variant.CONTENT;
}
function isMonochrome(scheme) {
	return scheme.variant === Variant.MONOCHROME;
}
function findDesiredChromaByTone(hue, chroma, tone, byDecreasingTone) {
	let answer = tone, closestToChroma = Hct.from(hue, chroma, tone);
	if (closestToChroma.chroma < chroma) {
		let chromaPeak = closestToChroma.chroma;
		for (; closestToChroma.chroma < chroma;) {
			answer += byDecreasingTone ? -1 : 1;
			const potentialSolution = Hct.from(hue, chroma, answer);
			if (chromaPeak > potentialSolution.chroma) break;
			if (Math.abs(potentialSolution.chroma - chroma) < .4) break;
			Math.abs(potentialSolution.chroma - chroma) < Math.abs(closestToChroma.chroma - chroma) && (closestToChroma = potentialSolution), chromaPeak = Math.max(chromaPeak, potentialSolution.chroma);
		}
	}
	return answer;
}
(function(Variant) {
	Variant[Variant.MONOCHROME = 0] = "MONOCHROME", Variant[Variant.NEUTRAL = 1] = "NEUTRAL", Variant[Variant.TONAL_SPOT = 2] = "TONAL_SPOT", Variant[Variant.VIBRANT = 3] = "VIBRANT", Variant[Variant.EXPRESSIVE = 4] = "EXPRESSIVE", Variant[Variant.FIDELITY = 5] = "FIDELITY", Variant[Variant.CONTENT = 6] = "CONTENT", Variant[Variant.RAINBOW = 7] = "RAINBOW", Variant[Variant.FRUIT_SALAD = 8] = "FRUIT_SALAD";
})(Variant || (Variant = {}));
var ColorSpecDelegateImpl2021 = class {
	primaryPaletteKeyColor() {
		return DynamicColor.fromPalette({
			name: "primary_palette_key_color",
			palette: (s) => s.primaryPalette,
			tone: (s) => s.primaryPalette.keyColor.tone
		});
	}
	secondaryPaletteKeyColor() {
		return DynamicColor.fromPalette({
			name: "secondary_palette_key_color",
			palette: (s) => s.secondaryPalette,
			tone: (s) => s.secondaryPalette.keyColor.tone
		});
	}
	tertiaryPaletteKeyColor() {
		return DynamicColor.fromPalette({
			name: "tertiary_palette_key_color",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => s.tertiaryPalette.keyColor.tone
		});
	}
	neutralPaletteKeyColor() {
		return DynamicColor.fromPalette({
			name: "neutral_palette_key_color",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.neutralPalette.keyColor.tone
		});
	}
	neutralVariantPaletteKeyColor() {
		return DynamicColor.fromPalette({
			name: "neutral_variant_palette_key_color",
			palette: (s) => s.neutralVariantPalette,
			tone: (s) => s.neutralVariantPalette.keyColor.tone
		});
	}
	errorPaletteKeyColor() {
		return DynamicColor.fromPalette({
			name: "error_palette_key_color",
			palette: (s) => s.errorPalette,
			tone: (s) => s.errorPalette.keyColor.tone
		});
	}
	background() {
		return DynamicColor.fromPalette({
			name: "background",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 6 : 98,
			isBackground: !0
		});
	}
	onBackground() {
		return DynamicColor.fromPalette({
			name: "on_background",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 90 : 10,
			background: (s) => this.background(),
			contrastCurve: (s) => new ContrastCurve(3, 3, 4.5, 7)
		});
	}
	surface() {
		return DynamicColor.fromPalette({
			name: "surface",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 6 : 98,
			isBackground: !0
		});
	}
	surfaceDim() {
		return DynamicColor.fromPalette({
			name: "surface_dim",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 6 : new ContrastCurve(87, 87, 80, 75).get(s.contrastLevel),
			isBackground: !0
		});
	}
	surfaceBright() {
		return DynamicColor.fromPalette({
			name: "surface_bright",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? new ContrastCurve(24, 24, 29, 34).get(s.contrastLevel) : 98,
			isBackground: !0
		});
	}
	surfaceContainerLowest() {
		return DynamicColor.fromPalette({
			name: "surface_container_lowest",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? new ContrastCurve(4, 4, 2, 0).get(s.contrastLevel) : 100,
			isBackground: !0
		});
	}
	surfaceContainerLow() {
		return DynamicColor.fromPalette({
			name: "surface_container_low",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? new ContrastCurve(10, 10, 11, 12).get(s.contrastLevel) : new ContrastCurve(96, 96, 96, 95).get(s.contrastLevel),
			isBackground: !0
		});
	}
	surfaceContainer() {
		return DynamicColor.fromPalette({
			name: "surface_container",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? new ContrastCurve(12, 12, 16, 20).get(s.contrastLevel) : new ContrastCurve(94, 94, 92, 90).get(s.contrastLevel),
			isBackground: !0
		});
	}
	surfaceContainerHigh() {
		return DynamicColor.fromPalette({
			name: "surface_container_high",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? new ContrastCurve(17, 17, 21, 25).get(s.contrastLevel) : new ContrastCurve(92, 92, 88, 85).get(s.contrastLevel),
			isBackground: !0
		});
	}
	surfaceContainerHighest() {
		return DynamicColor.fromPalette({
			name: "surface_container_highest",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? new ContrastCurve(22, 22, 26, 30).get(s.contrastLevel) : new ContrastCurve(90, 90, 84, 80).get(s.contrastLevel),
			isBackground: !0
		});
	}
	onSurface() {
		return DynamicColor.fromPalette({
			name: "on_surface",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 90 : 10,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	surfaceVariant() {
		return DynamicColor.fromPalette({
			name: "surface_variant",
			palette: (s) => s.neutralVariantPalette,
			tone: (s) => s.isDark ? 30 : 90,
			isBackground: !0
		});
	}
	onSurfaceVariant() {
		return DynamicColor.fromPalette({
			name: "on_surface_variant",
			palette: (s) => s.neutralVariantPalette,
			tone: (s) => s.isDark ? 80 : 30,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	inverseSurface() {
		return DynamicColor.fromPalette({
			name: "inverse_surface",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 90 : 20,
			isBackground: !0
		});
	}
	inverseOnSurface() {
		return DynamicColor.fromPalette({
			name: "inverse_on_surface",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 20 : 95,
			background: (s) => this.inverseSurface(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	outline() {
		return DynamicColor.fromPalette({
			name: "outline",
			palette: (s) => s.neutralVariantPalette,
			tone: (s) => s.isDark ? 60 : 50,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1.5, 3, 4.5, 7)
		});
	}
	outlineVariant() {
		return DynamicColor.fromPalette({
			name: "outline_variant",
			palette: (s) => s.neutralVariantPalette,
			tone: (s) => s.isDark ? 30 : 80,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5)
		});
	}
	shadow() {
		return DynamicColor.fromPalette({
			name: "shadow",
			palette: (s) => s.neutralPalette,
			tone: (s) => 0
		});
	}
	scrim() {
		return DynamicColor.fromPalette({
			name: "scrim",
			palette: (s) => s.neutralPalette,
			tone: (s) => 0
		});
	}
	surfaceTint() {
		return DynamicColor.fromPalette({
			name: "surface_tint",
			palette: (s) => s.primaryPalette,
			tone: (s) => s.isDark ? 80 : 40,
			isBackground: !0
		});
	}
	primary() {
		return DynamicColor.fromPalette({
			name: "primary",
			palette: (s) => s.primaryPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 100 : 0 : s.isDark ? 80 : 40,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 7),
			toneDeltaPair: (s) => new ToneDeltaPair(this.primaryContainer(), this.primary(), 10, "nearer", !1)
		});
	}
	primaryDim() {}
	onPrimary() {
		return DynamicColor.fromPalette({
			name: "on_primary",
			palette: (s) => s.primaryPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 10 : 90 : s.isDark ? 20 : 100,
			background: (s) => this.primary(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	primaryContainer() {
		return DynamicColor.fromPalette({
			name: "primary_container",
			palette: (s) => s.primaryPalette,
			tone: (s) => isFidelity(s) ? s.sourceColorHct.tone : isMonochrome(s) ? s.isDark ? 85 : 25 : s.isDark ? 30 : 90,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.primaryContainer(), this.primary(), 10, "nearer", !1)
		});
	}
	onPrimaryContainer() {
		return DynamicColor.fromPalette({
			name: "on_primary_container",
			palette: (s) => s.primaryPalette,
			tone: (s) => isFidelity(s) ? DynamicColor.foregroundTone(this.primaryContainer().tone(s), 4.5) : isMonochrome(s) ? s.isDark ? 0 : 100 : s.isDark ? 90 : 30,
			background: (s) => this.primaryContainer(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	inversePrimary() {
		return DynamicColor.fromPalette({
			name: "inverse_primary",
			palette: (s) => s.primaryPalette,
			tone: (s) => s.isDark ? 40 : 80,
			background: (s) => this.inverseSurface(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 7)
		});
	}
	secondary() {
		return DynamicColor.fromPalette({
			name: "secondary",
			palette: (s) => s.secondaryPalette,
			tone: (s) => s.isDark ? 80 : 40,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 7),
			toneDeltaPair: (s) => new ToneDeltaPair(this.secondaryContainer(), this.secondary(), 10, "nearer", !1)
		});
	}
	secondaryDim() {}
	onSecondary() {
		return DynamicColor.fromPalette({
			name: "on_secondary",
			palette: (s) => s.secondaryPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 10 : 100 : s.isDark ? 20 : 100,
			background: (s) => this.secondary(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	secondaryContainer() {
		return DynamicColor.fromPalette({
			name: "secondary_container",
			palette: (s) => s.secondaryPalette,
			tone: (s) => {
				const initialTone = s.isDark ? 30 : 90;
				return isMonochrome(s) ? s.isDark ? 30 : 85 : isFidelity(s) ? findDesiredChromaByTone(s.secondaryPalette.hue, s.secondaryPalette.chroma, initialTone, !s.isDark) : initialTone;
			},
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.secondaryContainer(), this.secondary(), 10, "nearer", !1)
		});
	}
	onSecondaryContainer() {
		return DynamicColor.fromPalette({
			name: "on_secondary_container",
			palette: (s) => s.secondaryPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 90 : 10 : isFidelity(s) ? DynamicColor.foregroundTone(this.secondaryContainer().tone(s), 4.5) : s.isDark ? 90 : 30,
			background: (s) => this.secondaryContainer(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	tertiary() {
		return DynamicColor.fromPalette({
			name: "tertiary",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 90 : 25 : s.isDark ? 80 : 40,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 7),
			toneDeltaPair: (s) => new ToneDeltaPair(this.tertiaryContainer(), this.tertiary(), 10, "nearer", !1)
		});
	}
	tertiaryDim() {}
	onTertiary() {
		return DynamicColor.fromPalette({
			name: "on_tertiary",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 10 : 90 : s.isDark ? 20 : 100,
			background: (s) => this.tertiary(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	tertiaryContainer() {
		return DynamicColor.fromPalette({
			name: "tertiary_container",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => {
				if (isMonochrome(s)) return s.isDark ? 60 : 49;
				if (!isFidelity(s)) return s.isDark ? 30 : 90;
				const proposedHct = s.tertiaryPalette.getHct(s.sourceColorHct.tone);
				return DislikeAnalyzer.fixIfDisliked(proposedHct).tone;
			},
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.tertiaryContainer(), this.tertiary(), 10, "nearer", !1)
		});
	}
	onTertiaryContainer() {
		return DynamicColor.fromPalette({
			name: "on_tertiary_container",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 0 : 100 : isFidelity(s) ? DynamicColor.foregroundTone(this.tertiaryContainer().tone(s), 4.5) : s.isDark ? 90 : 30,
			background: (s) => this.tertiaryContainer(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	error() {
		return DynamicColor.fromPalette({
			name: "error",
			palette: (s) => s.errorPalette,
			tone: (s) => s.isDark ? 80 : 40,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 7),
			toneDeltaPair: (s) => new ToneDeltaPair(this.errorContainer(), this.error(), 10, "nearer", !1)
		});
	}
	errorDim() {}
	onError() {
		return DynamicColor.fromPalette({
			name: "on_error",
			palette: (s) => s.errorPalette,
			tone: (s) => s.isDark ? 20 : 100,
			background: (s) => this.error(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	errorContainer() {
		return DynamicColor.fromPalette({
			name: "error_container",
			palette: (s) => s.errorPalette,
			tone: (s) => s.isDark ? 30 : 90,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.errorContainer(), this.error(), 10, "nearer", !1)
		});
	}
	onErrorContainer() {
		return DynamicColor.fromPalette({
			name: "on_error_container",
			palette: (s) => s.errorPalette,
			tone: (s) => isMonochrome(s) ? s.isDark ? 90 : 10 : s.isDark ? 90 : 30,
			background: (s) => this.errorContainer(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	primaryFixed() {
		return DynamicColor.fromPalette({
			name: "primary_fixed",
			palette: (s) => s.primaryPalette,
			tone: (s) => isMonochrome(s) ? 40 : 90,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.primaryFixed(), this.primaryFixedDim(), 10, "lighter", !0)
		});
	}
	primaryFixedDim() {
		return DynamicColor.fromPalette({
			name: "primary_fixed_dim",
			palette: (s) => s.primaryPalette,
			tone: (s) => isMonochrome(s) ? 30 : 80,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.primaryFixed(), this.primaryFixedDim(), 10, "lighter", !0)
		});
	}
	onPrimaryFixed() {
		return DynamicColor.fromPalette({
			name: "on_primary_fixed",
			palette: (s) => s.primaryPalette,
			tone: (s) => isMonochrome(s) ? 100 : 10,
			background: (s) => this.primaryFixedDim(),
			secondBackground: (s) => this.primaryFixed(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	onPrimaryFixedVariant() {
		return DynamicColor.fromPalette({
			name: "on_primary_fixed_variant",
			palette: (s) => s.primaryPalette,
			tone: (s) => isMonochrome(s) ? 90 : 30,
			background: (s) => this.primaryFixedDim(),
			secondBackground: (s) => this.primaryFixed(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	secondaryFixed() {
		return DynamicColor.fromPalette({
			name: "secondary_fixed",
			palette: (s) => s.secondaryPalette,
			tone: (s) => isMonochrome(s) ? 80 : 90,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.secondaryFixed(), this.secondaryFixedDim(), 10, "lighter", !0)
		});
	}
	secondaryFixedDim() {
		return DynamicColor.fromPalette({
			name: "secondary_fixed_dim",
			palette: (s) => s.secondaryPalette,
			tone: (s) => isMonochrome(s) ? 70 : 80,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.secondaryFixed(), this.secondaryFixedDim(), 10, "lighter", !0)
		});
	}
	onSecondaryFixed() {
		return DynamicColor.fromPalette({
			name: "on_secondary_fixed",
			palette: (s) => s.secondaryPalette,
			tone: (s) => 10,
			background: (s) => this.secondaryFixedDim(),
			secondBackground: (s) => this.secondaryFixed(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	onSecondaryFixedVariant() {
		return DynamicColor.fromPalette({
			name: "on_secondary_fixed_variant",
			palette: (s) => s.secondaryPalette,
			tone: (s) => isMonochrome(s) ? 25 : 30,
			background: (s) => this.secondaryFixedDim(),
			secondBackground: (s) => this.secondaryFixed(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	tertiaryFixed() {
		return DynamicColor.fromPalette({
			name: "tertiary_fixed",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => isMonochrome(s) ? 40 : 90,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.tertiaryFixed(), this.tertiaryFixedDim(), 10, "lighter", !0)
		});
	}
	tertiaryFixedDim() {
		return DynamicColor.fromPalette({
			name: "tertiary_fixed_dim",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => isMonochrome(s) ? 30 : 80,
			isBackground: !0,
			background: (s) => this.highestSurface(s),
			contrastCurve: (s) => new ContrastCurve(1, 1, 3, 4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.tertiaryFixed(), this.tertiaryFixedDim(), 10, "lighter", !0)
		});
	}
	onTertiaryFixed() {
		return DynamicColor.fromPalette({
			name: "on_tertiary_fixed",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => isMonochrome(s) ? 100 : 10,
			background: (s) => this.tertiaryFixedDim(),
			secondBackground: (s) => this.tertiaryFixed(),
			contrastCurve: (s) => new ContrastCurve(4.5, 7, 11, 21)
		});
	}
	onTertiaryFixedVariant() {
		return DynamicColor.fromPalette({
			name: "on_tertiary_fixed_variant",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => isMonochrome(s) ? 90 : 30,
			background: (s) => this.tertiaryFixedDim(),
			secondBackground: (s) => this.tertiaryFixed(),
			contrastCurve: (s) => new ContrastCurve(3, 4.5, 7, 11)
		});
	}
	highestSurface(s) {
		return s.isDark ? this.surfaceBright() : this.surfaceDim();
	}
};
function tMaxC(palette, lowerBound = 0, upperBound = 100, chromaMultiplier = 1) {
	return clampDouble(lowerBound, upperBound, findBestToneForChroma(palette.hue, palette.chroma * chromaMultiplier, 100, !0));
}
function tMinC(palette, lowerBound = 0, upperBound = 100) {
	return clampDouble(lowerBound, upperBound, findBestToneForChroma(palette.hue, palette.chroma, 0, !1));
}
function findBestToneForChroma(hue, chroma, tone, byDecreasingTone) {
	let answer = tone, bestCandidate = Hct.from(hue, chroma, answer);
	for (; bestCandidate.chroma < chroma && !(tone < 0 || tone > 100);) {
		tone += byDecreasingTone ? -1 : 1;
		const newCandidate = Hct.from(hue, chroma, tone);
		bestCandidate.chroma < newCandidate.chroma && (bestCandidate = newCandidate, answer = tone);
	}
	return answer;
}
function getCurve(defaultContrast) {
	return 1.5 === defaultContrast ? new ContrastCurve(1.5, 1.5, 3, 4.5) : 3 === defaultContrast ? new ContrastCurve(3, 3, 4.5, 7) : 4.5 === defaultContrast ? new ContrastCurve(4.5, 4.5, 7, 11) : 6 === defaultContrast ? new ContrastCurve(6, 6, 7, 11) : 7 === defaultContrast ? new ContrastCurve(7, 7, 11, 21) : 9 === defaultContrast ? new ContrastCurve(9, 9, 11, 21) : 11 === defaultContrast ? new ContrastCurve(11, 11, 21, 21) : 21 === defaultContrast ? new ContrastCurve(21, 21, 21, 21) : new ContrastCurve(defaultContrast, defaultContrast, 7, 21);
}
var ColorSpecDelegateImpl2025 = class extends ColorSpecDelegateImpl2021 {
	surface() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface",
			palette: (s) => s.neutralPalette,
			tone: (s) => (super.surface().tone(s), "phone" === s.platform ? s.isDark ? 4 : Hct.isYellow(s.neutralPalette.hue) ? 99 : s.variant === Variant.VIBRANT ? 97 : 98 : 0),
			isBackground: !0
		});
		return extendSpecVersion(super.surface(), "2025", color2025);
	}
	surfaceDim() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface_dim",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 4 : Hct.isYellow(s.neutralPalette.hue) ? 90 : s.variant === Variant.VIBRANT ? 85 : 87,
			isBackground: !0,
			chromaMultiplier: (s) => {
				if (!s.isDark) {
					if (s.variant === Variant.NEUTRAL) return 2.5;
					if (s.variant === Variant.TONAL_SPOT) return 1.7;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? 2.7 : 1.75;
					if (s.variant === Variant.VIBRANT) return 1.36;
				}
				return 1;
			}
		});
		return extendSpecVersion(super.surfaceDim(), "2025", color2025);
	}
	surfaceBright() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface_bright",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 18 : Hct.isYellow(s.neutralPalette.hue) ? 99 : s.variant === Variant.VIBRANT ? 97 : 98,
			isBackground: !0,
			chromaMultiplier: (s) => {
				if (s.isDark) {
					if (s.variant === Variant.NEUTRAL) return 2.5;
					if (s.variant === Variant.TONAL_SPOT) return 1.7;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? 2.7 : 1.75;
					if (s.variant === Variant.VIBRANT) return 1.36;
				}
				return 1;
			}
		});
		return extendSpecVersion(super.surfaceBright(), "2025", color2025);
	}
	surfaceContainerLowest() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface_container_lowest",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 0 : 100,
			isBackground: !0
		});
		return extendSpecVersion(super.surfaceContainerLowest(), "2025", color2025);
	}
	surfaceContainerLow() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface_container_low",
			palette: (s) => s.neutralPalette,
			tone: (s) => "phone" === s.platform ? s.isDark ? 6 : Hct.isYellow(s.neutralPalette.hue) ? 98 : s.variant === Variant.VIBRANT ? 95 : 96 : 15,
			isBackground: !0,
			chromaMultiplier: (s) => {
				if ("phone" === s.platform) {
					if (s.variant === Variant.NEUTRAL) return 1.3;
					if (s.variant === Variant.TONAL_SPOT) return 1.25;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? 1.3 : 1.15;
					if (s.variant === Variant.VIBRANT) return 1.08;
				}
				return 1;
			}
		});
		return extendSpecVersion(super.surfaceContainerLow(), "2025", color2025);
	}
	surfaceContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface_container",
			palette: (s) => s.neutralPalette,
			tone: (s) => "phone" === s.platform ? s.isDark ? 9 : Hct.isYellow(s.neutralPalette.hue) ? 96 : s.variant === Variant.VIBRANT ? 92 : 94 : 20,
			isBackground: !0,
			chromaMultiplier: (s) => {
				if ("phone" === s.platform) {
					if (s.variant === Variant.NEUTRAL) return 1.6;
					if (s.variant === Variant.TONAL_SPOT) return 1.4;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? 1.6 : 1.3;
					if (s.variant === Variant.VIBRANT) return 1.15;
				}
				return 1;
			}
		});
		return extendSpecVersion(super.surfaceContainer(), "2025", color2025);
	}
	surfaceContainerHigh() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface_container_high",
			palette: (s) => s.neutralPalette,
			tone: (s) => "phone" === s.platform ? s.isDark ? 12 : Hct.isYellow(s.neutralPalette.hue) ? 94 : s.variant === Variant.VIBRANT ? 90 : 92 : 25,
			isBackground: !0,
			chromaMultiplier: (s) => {
				if ("phone" === s.platform) {
					if (s.variant === Variant.NEUTRAL) return 1.9;
					if (s.variant === Variant.TONAL_SPOT) return 1.5;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? 1.95 : 1.45;
					if (s.variant === Variant.VIBRANT) return 1.22;
				}
				return 1;
			}
		});
		return extendSpecVersion(super.surfaceContainerHigh(), "2025", color2025);
	}
	surfaceContainerHighest() {
		const color2025 = DynamicColor.fromPalette({
			name: "surface_container_highest",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 15 : Hct.isYellow(s.neutralPalette.hue) ? 92 : s.variant === Variant.VIBRANT ? 88 : 90,
			isBackground: !0,
			chromaMultiplier: (s) => s.variant === Variant.NEUTRAL ? 2.2 : s.variant === Variant.TONAL_SPOT ? 1.7 : s.variant === Variant.EXPRESSIVE ? Hct.isYellow(s.neutralPalette.hue) ? 2.3 : 1.6 : s.variant === Variant.VIBRANT ? 1.29 : 1
		});
		return extendSpecVersion(super.surfaceContainerHighest(), "2025", color2025);
	}
	onSurface() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_surface",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.variant === Variant.VIBRANT ? tMaxC(s.neutralPalette, 0, 100, 1.1) : DynamicColor.getInitialToneFromBackground((s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh())(s),
			chromaMultiplier: (s) => {
				if ("phone" === s.platform) {
					if (s.variant === Variant.NEUTRAL) return 2.2;
					if (s.variant === Variant.TONAL_SPOT) return 1.7;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? s.isDark ? 3 : 2.3 : 1.6;
				}
				return 1;
			},
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => s.isDark ? getCurve(11) : getCurve(9)
		});
		return extendSpecVersion(super.onSurface(), "2025", color2025);
	}
	onSurfaceVariant() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_surface_variant",
			palette: (s) => s.neutralPalette,
			chromaMultiplier: (s) => {
				if ("phone" === s.platform) {
					if (s.variant === Variant.NEUTRAL) return 2.2;
					if (s.variant === Variant.TONAL_SPOT) return 1.7;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? s.isDark ? 3 : 2.3 : 1.6;
				}
				return 1;
			},
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => "phone" === s.platform ? s.isDark ? getCurve(6) : getCurve(4.5) : getCurve(7)
		});
		return extendSpecVersion(super.onSurfaceVariant(), "2025", color2025);
	}
	outline() {
		const color2025 = DynamicColor.fromPalette({
			name: "outline",
			palette: (s) => s.neutralPalette,
			chromaMultiplier: (s) => {
				if ("phone" === s.platform) {
					if (s.variant === Variant.NEUTRAL) return 2.2;
					if (s.variant === Variant.TONAL_SPOT) return 1.7;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? s.isDark ? 3 : 2.3 : 1.6;
				}
				return 1;
			},
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(3) : getCurve(4.5)
		});
		return extendSpecVersion(super.outline(), "2025", color2025);
	}
	outlineVariant() {
		const color2025 = DynamicColor.fromPalette({
			name: "outline_variant",
			palette: (s) => s.neutralPalette,
			chromaMultiplier: (s) => {
				if ("phone" === s.platform) {
					if (s.variant === Variant.NEUTRAL) return 2.2;
					if (s.variant === Variant.TONAL_SPOT) return 1.7;
					if (s.variant === Variant.EXPRESSIVE) return Hct.isYellow(s.neutralPalette.hue) ? s.isDark ? 3 : 2.3 : 1.6;
				}
				return 1;
			},
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(1.5) : getCurve(3)
		});
		return extendSpecVersion(super.outlineVariant(), "2025", color2025);
	}
	inverseSurface() {
		const color2025 = DynamicColor.fromPalette({
			name: "inverse_surface",
			palette: (s) => s.neutralPalette,
			tone: (s) => s.isDark ? 98 : 4,
			isBackground: !0
		});
		return extendSpecVersion(super.inverseSurface(), "2025", color2025);
	}
	inverseOnSurface() {
		const color2025 = DynamicColor.fromPalette({
			name: "inverse_on_surface",
			palette: (s) => s.neutralPalette,
			background: (s) => this.inverseSurface(),
			contrastCurve: (s) => getCurve(7)
		});
		return extendSpecVersion(super.inverseOnSurface(), "2025", color2025);
	}
	primary() {
		const color2025 = DynamicColor.fromPalette({
			name: "primary",
			palette: (s) => s.primaryPalette,
			tone: (s) => s.variant === Variant.NEUTRAL ? "phone" === s.platform ? s.isDark ? 80 : 40 : 90 : s.variant === Variant.TONAL_SPOT ? "phone" === s.platform ? s.isDark ? 80 : tMaxC(s.primaryPalette) : tMaxC(s.primaryPalette, 0, 90) : s.variant === Variant.EXPRESSIVE ? tMaxC(s.primaryPalette, 0, Hct.isYellow(s.primaryPalette.hue) ? 25 : Hct.isCyan(s.primaryPalette.hue) ? 88 : 98) : tMaxC(s.primaryPalette, 0, Hct.isCyan(s.primaryPalette.hue) ? 88 : 98),
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(4.5) : getCurve(7),
			toneDeltaPair: (s) => "phone" === s.platform ? new ToneDeltaPair(this.primaryContainer(), this.primary(), 5, "relative_lighter", !0, "farther") : void 0
		});
		return extendSpecVersion(super.primary(), "2025", color2025);
	}
	primaryDim() {
		return DynamicColor.fromPalette({
			name: "primary_dim",
			palette: (s) => s.primaryPalette,
			tone: (s) => s.variant === Variant.NEUTRAL ? 85 : s.variant === Variant.TONAL_SPOT ? tMaxC(s.primaryPalette, 0, 90) : tMaxC(s.primaryPalette),
			isBackground: !0,
			background: (s) => this.surfaceContainerHigh(),
			contrastCurve: (s) => getCurve(4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.primaryDim(), this.primary(), 5, "darker", !0, "farther")
		});
	}
	onPrimary() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_primary",
			palette: (s) => s.primaryPalette,
			background: (s) => "phone" === s.platform ? this.primary() : this.primaryDim(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.onPrimary(), "2025", color2025);
	}
	primaryContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "primary_container",
			palette: (s) => s.primaryPalette,
			tone: (s) => "watch" === s.platform ? 30 : s.variant === Variant.NEUTRAL ? s.isDark ? 30 : 90 : s.variant === Variant.TONAL_SPOT ? s.isDark ? tMinC(s.primaryPalette, 35, 93) : tMaxC(s.primaryPalette, 0, 90) : s.variant === Variant.EXPRESSIVE ? s.isDark ? tMaxC(s.primaryPalette, 30, 93) : tMaxC(s.primaryPalette, 78, Hct.isCyan(s.primaryPalette.hue) ? 88 : 90) : s.isDark ? tMinC(s.primaryPalette, 66, 93) : tMaxC(s.primaryPalette, 66, Hct.isCyan(s.primaryPalette.hue) ? 88 : 93),
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : void 0,
			toneDeltaPair: (s) => "phone" === s.platform ? void 0 : new ToneDeltaPair(this.primaryContainer(), this.primaryDim(), 10, "darker", !0, "farther"),
			contrastCurve: (s) => "phone" === s.platform && s.contrastLevel > 0 ? getCurve(1.5) : void 0
		});
		return extendSpecVersion(super.primaryContainer(), "2025", color2025);
	}
	onPrimaryContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_primary_container",
			palette: (s) => s.primaryPalette,
			background: (s) => this.primaryContainer(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.onPrimaryContainer(), "2025", color2025);
	}
	primaryFixed() {
		const color2025 = DynamicColor.fromPalette({
			name: "primary_fixed",
			palette: (s) => s.primaryPalette,
			tone: (s) => {
				let tempS = Object.assign({}, s, {
					isDark: !1,
					contrastLevel: 0
				});
				return this.primaryContainer().getTone(tempS);
			},
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : void 0,
			contrastCurve: (s) => "phone" === s.platform && s.contrastLevel > 0 ? getCurve(1.5) : void 0
		});
		return extendSpecVersion(super.primaryFixed(), "2025", color2025);
	}
	primaryFixedDim() {
		const color2025 = DynamicColor.fromPalette({
			name: "primary_fixed_dim",
			palette: (s) => s.primaryPalette,
			tone: (s) => this.primaryFixed().getTone(s),
			isBackground: !0,
			toneDeltaPair: (s) => new ToneDeltaPair(this.primaryFixedDim(), this.primaryFixed(), 5, "darker", !0, "exact")
		});
		return extendSpecVersion(super.primaryFixedDim(), "2025", color2025);
	}
	onPrimaryFixed() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_primary_fixed",
			palette: (s) => s.primaryPalette,
			background: (s) => this.primaryFixedDim(),
			contrastCurve: (s) => getCurve(7)
		});
		return extendSpecVersion(super.onPrimaryFixed(), "2025", color2025);
	}
	onPrimaryFixedVariant() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_primary_fixed_variant",
			palette: (s) => s.primaryPalette,
			background: (s) => this.primaryFixedDim(),
			contrastCurve: (s) => getCurve(4.5)
		});
		return extendSpecVersion(super.onPrimaryFixedVariant(), "2025", color2025);
	}
	inversePrimary() {
		const color2025 = DynamicColor.fromPalette({
			name: "inverse_primary",
			palette: (s) => s.primaryPalette,
			tone: (s) => tMaxC(s.primaryPalette),
			background: (s) => this.inverseSurface(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.inversePrimary(), "2025", color2025);
	}
	secondary() {
		const color2025 = DynamicColor.fromPalette({
			name: "secondary",
			palette: (s) => s.secondaryPalette,
			tone: (s) => "watch" === s.platform ? s.variant === Variant.NEUTRAL ? 90 : tMaxC(s.secondaryPalette, 0, 90) : s.variant === Variant.NEUTRAL ? s.isDark ? tMinC(s.secondaryPalette, 0, 98) : tMaxC(s.secondaryPalette) : s.variant === Variant.VIBRANT ? tMaxC(s.secondaryPalette, 0, s.isDark ? 90 : 98) : s.isDark ? 80 : tMaxC(s.secondaryPalette),
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(4.5) : getCurve(7),
			toneDeltaPair: (s) => "phone" === s.platform ? new ToneDeltaPair(this.secondaryContainer(), this.secondary(), 5, "relative_lighter", !0, "farther") : void 0
		});
		return extendSpecVersion(super.secondary(), "2025", color2025);
	}
	secondaryDim() {
		return DynamicColor.fromPalette({
			name: "secondary_dim",
			palette: (s) => s.secondaryPalette,
			tone: (s) => s.variant === Variant.NEUTRAL ? 85 : tMaxC(s.secondaryPalette, 0, 90),
			isBackground: !0,
			background: (s) => this.surfaceContainerHigh(),
			contrastCurve: (s) => getCurve(4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.secondaryDim(), this.secondary(), 5, "darker", !0, "farther")
		});
	}
	onSecondary() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_secondary",
			palette: (s) => s.secondaryPalette,
			background: (s) => "phone" === s.platform ? this.secondary() : this.secondaryDim(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.onSecondary(), "2025", color2025);
	}
	secondaryContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "secondary_container",
			palette: (s) => s.secondaryPalette,
			tone: (s) => "watch" === s.platform ? 30 : s.variant === Variant.VIBRANT ? s.isDark ? tMinC(s.secondaryPalette, 30, 40) : tMaxC(s.secondaryPalette, 84, 90) : s.variant === Variant.EXPRESSIVE ? s.isDark ? 15 : tMaxC(s.secondaryPalette, 90, 95) : s.isDark ? 25 : 90,
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : void 0,
			toneDeltaPair: (s) => "watch" === s.platform ? new ToneDeltaPair(this.secondaryContainer(), this.secondaryDim(), 10, "darker", !0, "farther") : void 0,
			contrastCurve: (s) => "phone" === s.platform && s.contrastLevel > 0 ? getCurve(1.5) : void 0
		});
		return extendSpecVersion(super.secondaryContainer(), "2025", color2025);
	}
	onSecondaryContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_secondary_container",
			palette: (s) => s.secondaryPalette,
			background: (s) => this.secondaryContainer(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.onSecondaryContainer(), "2025", color2025);
	}
	secondaryFixed() {
		const color2025 = DynamicColor.fromPalette({
			name: "secondary_fixed",
			palette: (s) => s.secondaryPalette,
			tone: (s) => {
				let tempS = Object.assign({}, s, {
					isDark: !1,
					contrastLevel: 0
				});
				return this.secondaryContainer().getTone(tempS);
			},
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : void 0,
			contrastCurve: (s) => "phone" === s.platform && s.contrastLevel > 0 ? getCurve(1.5) : void 0
		});
		return extendSpecVersion(super.secondaryFixed(), "2025", color2025);
	}
	secondaryFixedDim() {
		const color2025 = DynamicColor.fromPalette({
			name: "secondary_fixed_dim",
			palette: (s) => s.secondaryPalette,
			tone: (s) => this.secondaryFixed().getTone(s),
			isBackground: !0,
			toneDeltaPair: (s) => new ToneDeltaPair(this.secondaryFixedDim(), this.secondaryFixed(), 5, "darker", !0, "exact")
		});
		return extendSpecVersion(super.secondaryFixedDim(), "2025", color2025);
	}
	onSecondaryFixed() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_secondary_fixed",
			palette: (s) => s.secondaryPalette,
			background: (s) => this.secondaryFixedDim(),
			contrastCurve: (s) => getCurve(7)
		});
		return extendSpecVersion(super.onSecondaryFixed(), "2025", color2025);
	}
	onSecondaryFixedVariant() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_secondary_fixed_variant",
			palette: (s) => s.secondaryPalette,
			background: (s) => this.secondaryFixedDim(),
			contrastCurve: (s) => getCurve(4.5)
		});
		return extendSpecVersion(super.onSecondaryFixedVariant(), "2025", color2025);
	}
	tertiary() {
		const color2025 = DynamicColor.fromPalette({
			name: "tertiary",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => "watch" === s.platform ? s.variant === Variant.TONAL_SPOT ? tMaxC(s.tertiaryPalette, 0, 90) : tMaxC(s.tertiaryPalette) : s.variant === Variant.EXPRESSIVE || s.variant === Variant.VIBRANT ? tMaxC(s.tertiaryPalette, 0, Hct.isCyan(s.tertiaryPalette.hue) ? 88 : s.isDark ? 98 : 100) : s.isDark ? tMaxC(s.tertiaryPalette, 0, 98) : tMaxC(s.tertiaryPalette),
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(4.5) : getCurve(7),
			toneDeltaPair: (s) => "phone" === s.platform ? new ToneDeltaPair(this.tertiaryContainer(), this.tertiary(), 5, "relative_lighter", !0, "farther") : void 0
		});
		return extendSpecVersion(super.tertiary(), "2025", color2025);
	}
	tertiaryDim() {
		return DynamicColor.fromPalette({
			name: "tertiary_dim",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => s.variant === Variant.TONAL_SPOT ? tMaxC(s.tertiaryPalette, 0, 90) : tMaxC(s.tertiaryPalette),
			isBackground: !0,
			background: (s) => this.surfaceContainerHigh(),
			contrastCurve: (s) => getCurve(4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.tertiaryDim(), this.tertiary(), 5, "darker", !0, "farther")
		});
	}
	onTertiary() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_tertiary",
			palette: (s) => s.tertiaryPalette,
			background: (s) => "phone" === s.platform ? this.tertiary() : this.tertiaryDim(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.onTertiary(), "2025", color2025);
	}
	tertiaryContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "tertiary_container",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => "watch" === s.platform ? s.variant === Variant.TONAL_SPOT ? tMaxC(s.tertiaryPalette, 0, 90) : tMaxC(s.tertiaryPalette) : s.variant === Variant.NEUTRAL ? s.isDark ? tMaxC(s.tertiaryPalette, 0, 93) : tMaxC(s.tertiaryPalette, 0, 96) : s.variant === Variant.TONAL_SPOT ? tMaxC(s.tertiaryPalette, 0, s.isDark ? 93 : 100) : s.variant === Variant.EXPRESSIVE ? tMaxC(s.tertiaryPalette, 75, Hct.isCyan(s.tertiaryPalette.hue) ? 88 : s.isDark ? 93 : 100) : s.isDark ? tMaxC(s.tertiaryPalette, 0, 93) : tMaxC(s.tertiaryPalette, 72, 100),
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : void 0,
			toneDeltaPair: (s) => "watch" === s.platform ? new ToneDeltaPair(this.tertiaryContainer(), this.tertiaryDim(), 10, "darker", !0, "farther") : void 0,
			contrastCurve: (s) => "phone" === s.platform && s.contrastLevel > 0 ? getCurve(1.5) : void 0
		});
		return extendSpecVersion(super.tertiaryContainer(), "2025", color2025);
	}
	onTertiaryContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_tertiary_container",
			palette: (s) => s.tertiaryPalette,
			background: (s) => this.tertiaryContainer(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.onTertiaryContainer(), "2025", color2025);
	}
	tertiaryFixed() {
		const color2025 = DynamicColor.fromPalette({
			name: "tertiary_fixed",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => {
				let tempS = Object.assign({}, s, {
					isDark: !1,
					contrastLevel: 0
				});
				return this.tertiaryContainer().getTone(tempS);
			},
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : void 0,
			contrastCurve: (s) => "phone" === s.platform && s.contrastLevel > 0 ? getCurve(1.5) : void 0
		});
		return extendSpecVersion(super.tertiaryFixed(), "2025", color2025);
	}
	tertiaryFixedDim() {
		const color2025 = DynamicColor.fromPalette({
			name: "tertiary_fixed_dim",
			palette: (s) => s.tertiaryPalette,
			tone: (s) => this.tertiaryFixed().getTone(s),
			isBackground: !0,
			toneDeltaPair: (s) => new ToneDeltaPair(this.tertiaryFixedDim(), this.tertiaryFixed(), 5, "darker", !0, "exact")
		});
		return extendSpecVersion(super.tertiaryFixedDim(), "2025", color2025);
	}
	onTertiaryFixed() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_tertiary_fixed",
			palette: (s) => s.tertiaryPalette,
			background: (s) => this.tertiaryFixedDim(),
			contrastCurve: (s) => getCurve(7)
		});
		return extendSpecVersion(super.onTertiaryFixed(), "2025", color2025);
	}
	onTertiaryFixedVariant() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_tertiary_fixed_variant",
			palette: (s) => s.tertiaryPalette,
			background: (s) => this.tertiaryFixedDim(),
			contrastCurve: (s) => getCurve(4.5)
		});
		return extendSpecVersion(super.onTertiaryFixedVariant(), "2025", color2025);
	}
	error() {
		const color2025 = DynamicColor.fromPalette({
			name: "error",
			palette: (s) => s.errorPalette,
			tone: (s) => "phone" === s.platform ? s.isDark ? tMinC(s.errorPalette, 0, 98) : tMaxC(s.errorPalette) : tMinC(s.errorPalette),
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : this.surfaceContainerHigh(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(4.5) : getCurve(7),
			toneDeltaPair: (s) => "phone" === s.platform ? new ToneDeltaPair(this.errorContainer(), this.error(), 5, "relative_lighter", !0, "farther") : void 0
		});
		return extendSpecVersion(super.error(), "2025", color2025);
	}
	errorDim() {
		return DynamicColor.fromPalette({
			name: "error_dim",
			palette: (s) => s.errorPalette,
			tone: (s) => tMinC(s.errorPalette),
			isBackground: !0,
			background: (s) => this.surfaceContainerHigh(),
			contrastCurve: (s) => getCurve(4.5),
			toneDeltaPair: (s) => new ToneDeltaPair(this.errorDim(), this.error(), 5, "darker", !0, "farther")
		});
	}
	onError() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_error",
			palette: (s) => s.errorPalette,
			background: (s) => "phone" === s.platform ? this.error() : this.errorDim(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(6) : getCurve(7)
		});
		return extendSpecVersion(super.onError(), "2025", color2025);
	}
	errorContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "error_container",
			palette: (s) => s.errorPalette,
			tone: (s) => "watch" === s.platform ? 30 : s.isDark ? tMinC(s.errorPalette, 30, 93) : tMaxC(s.errorPalette, 0, 90),
			isBackground: !0,
			background: (s) => "phone" === s.platform ? this.highestSurface(s) : void 0,
			toneDeltaPair: (s) => "watch" === s.platform ? new ToneDeltaPair(this.errorContainer(), this.errorDim(), 10, "darker", !0, "farther") : void 0,
			contrastCurve: (s) => "phone" === s.platform && s.contrastLevel > 0 ? getCurve(1.5) : void 0
		});
		return extendSpecVersion(super.errorContainer(), "2025", color2025);
	}
	onErrorContainer() {
		const color2025 = DynamicColor.fromPalette({
			name: "on_error_container",
			palette: (s) => s.errorPalette,
			background: (s) => this.errorContainer(),
			contrastCurve: (s) => "phone" === s.platform ? getCurve(4.5) : getCurve(7)
		});
		return extendSpecVersion(super.onErrorContainer(), "2025", color2025);
	}
	surfaceVariant() {
		const color2025 = Object.assign(this.surfaceContainerHighest().clone(), { name: "surface_variant" });
		return extendSpecVersion(super.surfaceVariant(), "2025", color2025);
	}
	surfaceTint() {
		const color2025 = Object.assign(this.primary().clone(), { name: "surface_tint" });
		return extendSpecVersion(super.surfaceTint(), "2025", color2025);
	}
	background() {
		const color2025 = Object.assign(this.surface().clone(), { name: "background" });
		return extendSpecVersion(super.background(), "2025", color2025);
	}
	onBackground() {
		const color2025 = Object.assign(this.onSurface().clone(), { name: "on_background" });
		return extendSpecVersion(super.onBackground(), "2025", color2025);
	}
};
var MaterialDynamicColors = class MaterialDynamicColors {
	constructor() {
		this.allColors = [
			this.background(),
			this.onBackground(),
			this.surface(),
			this.surfaceDim(),
			this.surfaceBright(),
			this.surfaceContainerLowest(),
			this.surfaceContainerLow(),
			this.surfaceContainer(),
			this.surfaceContainerHigh(),
			this.surfaceContainerHighest(),
			this.onSurface(),
			this.onSurfaceVariant(),
			this.outline(),
			this.outlineVariant(),
			this.inverseSurface(),
			this.inverseOnSurface(),
			this.primary(),
			this.primaryDim(),
			this.onPrimary(),
			this.primaryContainer(),
			this.onPrimaryContainer(),
			this.primaryFixed(),
			this.primaryFixedDim(),
			this.onPrimaryFixed(),
			this.onPrimaryFixedVariant(),
			this.inversePrimary(),
			this.secondary(),
			this.secondaryDim(),
			this.onSecondary(),
			this.secondaryContainer(),
			this.onSecondaryContainer(),
			this.secondaryFixed(),
			this.secondaryFixedDim(),
			this.onSecondaryFixed(),
			this.onSecondaryFixedVariant(),
			this.tertiary(),
			this.tertiaryDim(),
			this.onTertiary(),
			this.tertiaryContainer(),
			this.onTertiaryContainer(),
			this.tertiaryFixed(),
			this.tertiaryFixedDim(),
			this.onTertiaryFixed(),
			this.onTertiaryFixedVariant(),
			this.error(),
			this.errorDim(),
			this.onError(),
			this.errorContainer(),
			this.onErrorContainer()
		].filter((c) => void 0 !== c);
	}
	highestSurface(s) {
		return MaterialDynamicColors.colorSpec.highestSurface(s);
	}
	primaryPaletteKeyColor() {
		return MaterialDynamicColors.colorSpec.primaryPaletteKeyColor();
	}
	secondaryPaletteKeyColor() {
		return MaterialDynamicColors.colorSpec.secondaryPaletteKeyColor();
	}
	tertiaryPaletteKeyColor() {
		return MaterialDynamicColors.colorSpec.tertiaryPaletteKeyColor();
	}
	neutralPaletteKeyColor() {
		return MaterialDynamicColors.colorSpec.neutralPaletteKeyColor();
	}
	neutralVariantPaletteKeyColor() {
		return MaterialDynamicColors.colorSpec.neutralVariantPaletteKeyColor();
	}
	errorPaletteKeyColor() {
		return MaterialDynamicColors.colorSpec.errorPaletteKeyColor();
	}
	background() {
		return MaterialDynamicColors.colorSpec.background();
	}
	onBackground() {
		return MaterialDynamicColors.colorSpec.onBackground();
	}
	surface() {
		return MaterialDynamicColors.colorSpec.surface();
	}
	surfaceDim() {
		return MaterialDynamicColors.colorSpec.surfaceDim();
	}
	surfaceBright() {
		return MaterialDynamicColors.colorSpec.surfaceBright();
	}
	surfaceContainerLowest() {
		return MaterialDynamicColors.colorSpec.surfaceContainerLowest();
	}
	surfaceContainerLow() {
		return MaterialDynamicColors.colorSpec.surfaceContainerLow();
	}
	surfaceContainer() {
		return MaterialDynamicColors.colorSpec.surfaceContainer();
	}
	surfaceContainerHigh() {
		return MaterialDynamicColors.colorSpec.surfaceContainerHigh();
	}
	surfaceContainerHighest() {
		return MaterialDynamicColors.colorSpec.surfaceContainerHighest();
	}
	onSurface() {
		return MaterialDynamicColors.colorSpec.onSurface();
	}
	surfaceVariant() {
		return MaterialDynamicColors.colorSpec.surfaceVariant();
	}
	onSurfaceVariant() {
		return MaterialDynamicColors.colorSpec.onSurfaceVariant();
	}
	outline() {
		return MaterialDynamicColors.colorSpec.outline();
	}
	outlineVariant() {
		return MaterialDynamicColors.colorSpec.outlineVariant();
	}
	inverseSurface() {
		return MaterialDynamicColors.colorSpec.inverseSurface();
	}
	inverseOnSurface() {
		return MaterialDynamicColors.colorSpec.inverseOnSurface();
	}
	shadow() {
		return MaterialDynamicColors.colorSpec.shadow();
	}
	scrim() {
		return MaterialDynamicColors.colorSpec.scrim();
	}
	surfaceTint() {
		return MaterialDynamicColors.colorSpec.surfaceTint();
	}
	primary() {
		return MaterialDynamicColors.colorSpec.primary();
	}
	primaryDim() {
		return MaterialDynamicColors.colorSpec.primaryDim();
	}
	onPrimary() {
		return MaterialDynamicColors.colorSpec.onPrimary();
	}
	primaryContainer() {
		return MaterialDynamicColors.colorSpec.primaryContainer();
	}
	onPrimaryContainer() {
		return MaterialDynamicColors.colorSpec.onPrimaryContainer();
	}
	inversePrimary() {
		return MaterialDynamicColors.colorSpec.inversePrimary();
	}
	primaryFixed() {
		return MaterialDynamicColors.colorSpec.primaryFixed();
	}
	primaryFixedDim() {
		return MaterialDynamicColors.colorSpec.primaryFixedDim();
	}
	onPrimaryFixed() {
		return MaterialDynamicColors.colorSpec.onPrimaryFixed();
	}
	onPrimaryFixedVariant() {
		return MaterialDynamicColors.colorSpec.onPrimaryFixedVariant();
	}
	secondary() {
		return MaterialDynamicColors.colorSpec.secondary();
	}
	secondaryDim() {
		return MaterialDynamicColors.colorSpec.secondaryDim();
	}
	onSecondary() {
		return MaterialDynamicColors.colorSpec.onSecondary();
	}
	secondaryContainer() {
		return MaterialDynamicColors.colorSpec.secondaryContainer();
	}
	onSecondaryContainer() {
		return MaterialDynamicColors.colorSpec.onSecondaryContainer();
	}
	secondaryFixed() {
		return MaterialDynamicColors.colorSpec.secondaryFixed();
	}
	secondaryFixedDim() {
		return MaterialDynamicColors.colorSpec.secondaryFixedDim();
	}
	onSecondaryFixed() {
		return MaterialDynamicColors.colorSpec.onSecondaryFixed();
	}
	onSecondaryFixedVariant() {
		return MaterialDynamicColors.colorSpec.onSecondaryFixedVariant();
	}
	tertiary() {
		return MaterialDynamicColors.colorSpec.tertiary();
	}
	tertiaryDim() {
		return MaterialDynamicColors.colorSpec.tertiaryDim();
	}
	onTertiary() {
		return MaterialDynamicColors.colorSpec.onTertiary();
	}
	tertiaryContainer() {
		return MaterialDynamicColors.colorSpec.tertiaryContainer();
	}
	onTertiaryContainer() {
		return MaterialDynamicColors.colorSpec.onTertiaryContainer();
	}
	tertiaryFixed() {
		return MaterialDynamicColors.colorSpec.tertiaryFixed();
	}
	tertiaryFixedDim() {
		return MaterialDynamicColors.colorSpec.tertiaryFixedDim();
	}
	onTertiaryFixed() {
		return MaterialDynamicColors.colorSpec.onTertiaryFixed();
	}
	onTertiaryFixedVariant() {
		return MaterialDynamicColors.colorSpec.onTertiaryFixedVariant();
	}
	error() {
		return MaterialDynamicColors.colorSpec.error();
	}
	errorDim() {
		return MaterialDynamicColors.colorSpec.errorDim();
	}
	onError() {
		return MaterialDynamicColors.colorSpec.onError();
	}
	errorContainer() {
		return MaterialDynamicColors.colorSpec.errorContainer();
	}
	onErrorContainer() {
		return MaterialDynamicColors.colorSpec.onErrorContainer();
	}
	static highestSurface(s) {
		return MaterialDynamicColors.colorSpec.highestSurface(s);
	}
};
MaterialDynamicColors.contentAccentToneDelta = 15, MaterialDynamicColors.colorSpec = new ColorSpecDelegateImpl2025(), MaterialDynamicColors.primaryPaletteKeyColor = MaterialDynamicColors.colorSpec.primaryPaletteKeyColor(), MaterialDynamicColors.secondaryPaletteKeyColor = MaterialDynamicColors.colorSpec.secondaryPaletteKeyColor(), MaterialDynamicColors.tertiaryPaletteKeyColor = MaterialDynamicColors.colorSpec.tertiaryPaletteKeyColor(), MaterialDynamicColors.neutralPaletteKeyColor = MaterialDynamicColors.colorSpec.neutralPaletteKeyColor(), MaterialDynamicColors.neutralVariantPaletteKeyColor = MaterialDynamicColors.colorSpec.neutralVariantPaletteKeyColor(), MaterialDynamicColors.background = MaterialDynamicColors.colorSpec.background(), MaterialDynamicColors.onBackground = MaterialDynamicColors.colorSpec.onBackground(), MaterialDynamicColors.surface = MaterialDynamicColors.colorSpec.surface(), MaterialDynamicColors.surfaceDim = MaterialDynamicColors.colorSpec.surfaceDim(), MaterialDynamicColors.surfaceBright = MaterialDynamicColors.colorSpec.surfaceBright(), MaterialDynamicColors.surfaceContainerLowest = MaterialDynamicColors.colorSpec.surfaceContainerLowest(), MaterialDynamicColors.surfaceContainerLow = MaterialDynamicColors.colorSpec.surfaceContainerLow(), MaterialDynamicColors.surfaceContainer = MaterialDynamicColors.colorSpec.surfaceContainer(), MaterialDynamicColors.surfaceContainerHigh = MaterialDynamicColors.colorSpec.surfaceContainerHigh(), MaterialDynamicColors.surfaceContainerHighest = MaterialDynamicColors.colorSpec.surfaceContainerHighest(), MaterialDynamicColors.onSurface = MaterialDynamicColors.colorSpec.onSurface(), MaterialDynamicColors.surfaceVariant = MaterialDynamicColors.colorSpec.surfaceVariant(), MaterialDynamicColors.onSurfaceVariant = MaterialDynamicColors.colorSpec.onSurfaceVariant(), MaterialDynamicColors.inverseSurface = MaterialDynamicColors.colorSpec.inverseSurface(), MaterialDynamicColors.inverseOnSurface = MaterialDynamicColors.colorSpec.inverseOnSurface(), MaterialDynamicColors.outline = MaterialDynamicColors.colorSpec.outline(), MaterialDynamicColors.outlineVariant = MaterialDynamicColors.colorSpec.outlineVariant(), MaterialDynamicColors.shadow = MaterialDynamicColors.colorSpec.shadow(), MaterialDynamicColors.scrim = MaterialDynamicColors.colorSpec.scrim(), MaterialDynamicColors.surfaceTint = MaterialDynamicColors.colorSpec.surfaceTint(), MaterialDynamicColors.primary = MaterialDynamicColors.colorSpec.primary(), MaterialDynamicColors.onPrimary = MaterialDynamicColors.colorSpec.onPrimary(), MaterialDynamicColors.primaryContainer = MaterialDynamicColors.colorSpec.primaryContainer(), MaterialDynamicColors.onPrimaryContainer = MaterialDynamicColors.colorSpec.onPrimaryContainer(), MaterialDynamicColors.inversePrimary = MaterialDynamicColors.colorSpec.inversePrimary(), MaterialDynamicColors.secondary = MaterialDynamicColors.colorSpec.secondary(), MaterialDynamicColors.onSecondary = MaterialDynamicColors.colorSpec.onSecondary(), MaterialDynamicColors.secondaryContainer = MaterialDynamicColors.colorSpec.secondaryContainer(), MaterialDynamicColors.onSecondaryContainer = MaterialDynamicColors.colorSpec.onSecondaryContainer(), MaterialDynamicColors.tertiary = MaterialDynamicColors.colorSpec.tertiary(), MaterialDynamicColors.onTertiary = MaterialDynamicColors.colorSpec.onTertiary(), MaterialDynamicColors.tertiaryContainer = MaterialDynamicColors.colorSpec.tertiaryContainer(), MaterialDynamicColors.onTertiaryContainer = MaterialDynamicColors.colorSpec.onTertiaryContainer(), MaterialDynamicColors.error = MaterialDynamicColors.colorSpec.error(), MaterialDynamicColors.onError = MaterialDynamicColors.colorSpec.onError(), MaterialDynamicColors.errorContainer = MaterialDynamicColors.colorSpec.errorContainer(), MaterialDynamicColors.onErrorContainer = MaterialDynamicColors.colorSpec.onErrorContainer(), MaterialDynamicColors.primaryFixed = MaterialDynamicColors.colorSpec.primaryFixed(), MaterialDynamicColors.primaryFixedDim = MaterialDynamicColors.colorSpec.primaryFixedDim(), MaterialDynamicColors.onPrimaryFixed = MaterialDynamicColors.colorSpec.onPrimaryFixed(), MaterialDynamicColors.onPrimaryFixedVariant = MaterialDynamicColors.colorSpec.onPrimaryFixedVariant(), MaterialDynamicColors.secondaryFixed = MaterialDynamicColors.colorSpec.secondaryFixed(), MaterialDynamicColors.secondaryFixedDim = MaterialDynamicColors.colorSpec.secondaryFixedDim(), MaterialDynamicColors.onSecondaryFixed = MaterialDynamicColors.colorSpec.onSecondaryFixed(), MaterialDynamicColors.onSecondaryFixedVariant = MaterialDynamicColors.colorSpec.onSecondaryFixedVariant(), MaterialDynamicColors.tertiaryFixed = MaterialDynamicColors.colorSpec.tertiaryFixed(), MaterialDynamicColors.tertiaryFixedDim = MaterialDynamicColors.colorSpec.tertiaryFixedDim(), MaterialDynamicColors.onTertiaryFixed = MaterialDynamicColors.colorSpec.onTertiaryFixed(), MaterialDynamicColors.onTertiaryFixedVariant = MaterialDynamicColors.colorSpec.onTertiaryFixedVariant();
var DynamicScheme = class DynamicScheme {
	constructor(args) {
		this.sourceColorArgb = args.sourceColorHct.toInt(), this.variant = args.variant, this.contrastLevel = args.contrastLevel, this.isDark = args.isDark, this.platform = args.platform ?? "phone", this.specVersion = args.specVersion ?? "2021", this.sourceColorHct = args.sourceColorHct, this.primaryPalette = args.primaryPalette ?? getSpec(this.specVersion).getPrimaryPalette(this.variant, args.sourceColorHct, this.isDark, this.platform, this.contrastLevel), this.secondaryPalette = args.secondaryPalette ?? getSpec(this.specVersion).getSecondaryPalette(this.variant, args.sourceColorHct, this.isDark, this.platform, this.contrastLevel), this.tertiaryPalette = args.tertiaryPalette ?? getSpec(this.specVersion).getTertiaryPalette(this.variant, args.sourceColorHct, this.isDark, this.platform, this.contrastLevel), this.neutralPalette = args.neutralPalette ?? getSpec(this.specVersion).getNeutralPalette(this.variant, args.sourceColorHct, this.isDark, this.platform, this.contrastLevel), this.neutralVariantPalette = args.neutralVariantPalette ?? getSpec(this.specVersion).getNeutralVariantPalette(this.variant, args.sourceColorHct, this.isDark, this.platform, this.contrastLevel), this.errorPalette = args.errorPalette ?? getSpec(this.specVersion).getErrorPalette(this.variant, args.sourceColorHct, this.isDark, this.platform, this.contrastLevel) ?? TonalPalette.fromHueAndChroma(25, 84), this.colors = new MaterialDynamicColors();
	}
	toString() {
		return `Scheme: variant=${Variant[this.variant]}, mode=${this.isDark ? "dark" : "light"}, platform=${this.platform}, contrastLevel=${this.contrastLevel.toFixed(1)}, seed=${this.sourceColorHct.toString()}, specVersion=${this.specVersion}`;
	}
	static getPiecewiseHue(sourceColorHct, hueBreakpoints, hues) {
		const size = Math.min(hueBreakpoints.length - 1, hues.length), sourceHue = sourceColorHct.hue;
		for (let i = 0; i < size; i++) if (sourceHue >= hueBreakpoints[i] && sourceHue < hueBreakpoints[i + 1]) return sanitizeDegreesDouble(hues[i]);
		return sourceHue;
	}
	static getRotatedHue(sourceColorHct, hueBreakpoints, rotations) {
		let rotation = DynamicScheme.getPiecewiseHue(sourceColorHct, hueBreakpoints, rotations);
		return Math.min(hueBreakpoints.length - 1, rotations.length) <= 0 && (rotation = 0), sanitizeDegreesDouble(sourceColorHct.hue + rotation);
	}
	getArgb(dynamicColor) {
		return dynamicColor.getArgb(this);
	}
	getHct(dynamicColor) {
		return dynamicColor.getHct(this);
	}
	get primaryPaletteKeyColor() {
		return this.getArgb(this.colors.primaryPaletteKeyColor());
	}
	get secondaryPaletteKeyColor() {
		return this.getArgb(this.colors.secondaryPaletteKeyColor());
	}
	get tertiaryPaletteKeyColor() {
		return this.getArgb(this.colors.tertiaryPaletteKeyColor());
	}
	get neutralPaletteKeyColor() {
		return this.getArgb(this.colors.neutralPaletteKeyColor());
	}
	get neutralVariantPaletteKeyColor() {
		return this.getArgb(this.colors.neutralVariantPaletteKeyColor());
	}
	get errorPaletteKeyColor() {
		return this.getArgb(this.colors.errorPaletteKeyColor());
	}
	get background() {
		return this.getArgb(this.colors.background());
	}
	get onBackground() {
		return this.getArgb(this.colors.onBackground());
	}
	get surface() {
		return this.getArgb(this.colors.surface());
	}
	get surfaceDim() {
		return this.getArgb(this.colors.surfaceDim());
	}
	get surfaceBright() {
		return this.getArgb(this.colors.surfaceBright());
	}
	get surfaceContainerLowest() {
		return this.getArgb(this.colors.surfaceContainerLowest());
	}
	get surfaceContainerLow() {
		return this.getArgb(this.colors.surfaceContainerLow());
	}
	get surfaceContainer() {
		return this.getArgb(this.colors.surfaceContainer());
	}
	get surfaceContainerHigh() {
		return this.getArgb(this.colors.surfaceContainerHigh());
	}
	get surfaceContainerHighest() {
		return this.getArgb(this.colors.surfaceContainerHighest());
	}
	get onSurface() {
		return this.getArgb(this.colors.onSurface());
	}
	get surfaceVariant() {
		return this.getArgb(this.colors.surfaceVariant());
	}
	get onSurfaceVariant() {
		return this.getArgb(this.colors.onSurfaceVariant());
	}
	get inverseSurface() {
		return this.getArgb(this.colors.inverseSurface());
	}
	get inverseOnSurface() {
		return this.getArgb(this.colors.inverseOnSurface());
	}
	get outline() {
		return this.getArgb(this.colors.outline());
	}
	get outlineVariant() {
		return this.getArgb(this.colors.outlineVariant());
	}
	get shadow() {
		return this.getArgb(this.colors.shadow());
	}
	get scrim() {
		return this.getArgb(this.colors.scrim());
	}
	get surfaceTint() {
		return this.getArgb(this.colors.surfaceTint());
	}
	get primary() {
		return this.getArgb(this.colors.primary());
	}
	get primaryDim() {
		const primaryDim = this.colors.primaryDim();
		if (void 0 === primaryDim) throw new Error("`primaryDim` color is undefined prior to 2025 spec.");
		return this.getArgb(primaryDim);
	}
	get onPrimary() {
		return this.getArgb(this.colors.onPrimary());
	}
	get primaryContainer() {
		return this.getArgb(this.colors.primaryContainer());
	}
	get onPrimaryContainer() {
		return this.getArgb(this.colors.onPrimaryContainer());
	}
	get primaryFixed() {
		return this.getArgb(this.colors.primaryFixed());
	}
	get primaryFixedDim() {
		return this.getArgb(this.colors.primaryFixedDim());
	}
	get onPrimaryFixed() {
		return this.getArgb(this.colors.onPrimaryFixed());
	}
	get onPrimaryFixedVariant() {
		return this.getArgb(this.colors.onPrimaryFixedVariant());
	}
	get inversePrimary() {
		return this.getArgb(this.colors.inversePrimary());
	}
	get secondary() {
		return this.getArgb(this.colors.secondary());
	}
	get secondaryDim() {
		const secondaryDim = this.colors.secondaryDim();
		if (void 0 === secondaryDim) throw new Error("`secondaryDim` color is undefined prior to 2025 spec.");
		return this.getArgb(secondaryDim);
	}
	get onSecondary() {
		return this.getArgb(this.colors.onSecondary());
	}
	get secondaryContainer() {
		return this.getArgb(this.colors.secondaryContainer());
	}
	get onSecondaryContainer() {
		return this.getArgb(this.colors.onSecondaryContainer());
	}
	get secondaryFixed() {
		return this.getArgb(this.colors.secondaryFixed());
	}
	get secondaryFixedDim() {
		return this.getArgb(this.colors.secondaryFixedDim());
	}
	get onSecondaryFixed() {
		return this.getArgb(this.colors.onSecondaryFixed());
	}
	get onSecondaryFixedVariant() {
		return this.getArgb(this.colors.onSecondaryFixedVariant());
	}
	get tertiary() {
		return this.getArgb(this.colors.tertiary());
	}
	get tertiaryDim() {
		const tertiaryDim = this.colors.tertiaryDim();
		if (void 0 === tertiaryDim) throw new Error("`tertiaryDim` color is undefined prior to 2025 spec.");
		return this.getArgb(tertiaryDim);
	}
	get onTertiary() {
		return this.getArgb(this.colors.onTertiary());
	}
	get tertiaryContainer() {
		return this.getArgb(this.colors.tertiaryContainer());
	}
	get onTertiaryContainer() {
		return this.getArgb(this.colors.onTertiaryContainer());
	}
	get tertiaryFixed() {
		return this.getArgb(this.colors.tertiaryFixed());
	}
	get tertiaryFixedDim() {
		return this.getArgb(this.colors.tertiaryFixedDim());
	}
	get onTertiaryFixed() {
		return this.getArgb(this.colors.onTertiaryFixed());
	}
	get onTertiaryFixedVariant() {
		return this.getArgb(this.colors.onTertiaryFixedVariant());
	}
	get error() {
		return this.getArgb(this.colors.error());
	}
	get errorDim() {
		const errorDim = this.colors.errorDim();
		if (void 0 === errorDim) throw new Error("`errorDim` color is undefined prior to 2025 spec.");
		return this.getArgb(errorDim);
	}
	get onError() {
		return this.getArgb(this.colors.onError());
	}
	get errorContainer() {
		return this.getArgb(this.colors.errorContainer());
	}
	get onErrorContainer() {
		return this.getArgb(this.colors.onErrorContainer());
	}
};
DynamicScheme.DEFAULT_SPEC_VERSION = "2021", DynamicScheme.DEFAULT_PLATFORM = "phone";
var DynamicSchemePalettesDelegateImpl2021 = class {
	getPrimaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.CONTENT:
			case Variant.FIDELITY: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, sourceColorHct.chroma);
			case Variant.FRUIT_SALAD: return TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(sourceColorHct.hue - 50), 48);
			case Variant.MONOCHROME: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 0);
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 12);
			case Variant.RAINBOW: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 48);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 36);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(sourceColorHct.hue + 240), 40);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 200);
			default: throw new Error(`Unsupported variant: ${variant}`);
		}
	}
	getSecondaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.CONTENT:
			case Variant.FIDELITY: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, Math.max(sourceColorHct.chroma - 32, .5 * sourceColorHct.chroma));
			case Variant.FRUIT_SALAD: return TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(sourceColorHct.hue - 50), 36);
			case Variant.MONOCHROME: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 0);
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 8);
			case Variant.RAINBOW:
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 16);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				21,
				51,
				121,
				151,
				191,
				271,
				321,
				360
			], [
				45,
				95,
				45,
				20,
				45,
				90,
				45,
				45,
				45
			]), 24);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				41,
				61,
				101,
				131,
				181,
				251,
				301,
				360
			], [
				18,
				15,
				10,
				12,
				15,
				18,
				15,
				12,
				12
			]), 24);
			default: throw new Error(`Unsupported variant: ${variant}`);
		}
	}
	getTertiaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.CONTENT: return TonalPalette.fromHct(DislikeAnalyzer.fixIfDisliked(new TemperatureCache(sourceColorHct).analogous(3, 6)[2]));
			case Variant.FIDELITY: return TonalPalette.fromHct(DislikeAnalyzer.fixIfDisliked(new TemperatureCache(sourceColorHct).complement));
			case Variant.FRUIT_SALAD: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 36);
			case Variant.MONOCHROME: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 0);
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 16);
			case Variant.RAINBOW:
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(sourceColorHct.hue + 60), 24);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				21,
				51,
				121,
				151,
				191,
				271,
				321,
				360
			], [
				120,
				120,
				20,
				45,
				20,
				15,
				20,
				120,
				120
			]), 32);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				41,
				61,
				101,
				131,
				181,
				251,
				301,
				360
			], [
				35,
				30,
				20,
				25,
				30,
				35,
				30,
				25,
				25
			]), 32);
			default: throw new Error(`Unsupported variant: ${variant}`);
		}
	}
	getNeutralPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.CONTENT:
			case Variant.FIDELITY: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, sourceColorHct.chroma / 8);
			case Variant.FRUIT_SALAD: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 10);
			case Variant.MONOCHROME: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 0);
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 2);
			case Variant.RAINBOW: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 0);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 6);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(sourceColorHct.hue + 15), 8);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 10);
			default: throw new Error(`Unsupported variant: ${variant}`);
		}
	}
	getNeutralVariantPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.CONTENT:
			case Variant.FIDELITY: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, sourceColorHct.chroma / 8 + 4);
			case Variant.FRUIT_SALAD: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 16);
			case Variant.MONOCHROME: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 0);
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 2);
			case Variant.RAINBOW: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 0);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 8);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(sourceColorHct.hue + 15), 12);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 12);
			default: throw new Error(`Unsupported variant: ${variant}`);
		}
	}
	getErrorPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {}
};
var DynamicSchemePalettesDelegateImpl2025 = class DynamicSchemePalettesDelegateImpl2025 extends DynamicSchemePalettesDelegateImpl2021 {
	getPrimaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, "phone" === platform ? Hct.isBlue(sourceColorHct.hue) ? 12 : 8 : Hct.isBlue(sourceColorHct.hue) ? 16 : 12);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, "phone" === platform && isDark ? 26 : 32);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, "phone" === platform ? isDark ? 36 : 48 : 40);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, "phone" === platform ? 74 : 56);
			default: return super.getPrimaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel);
		}
	}
	getSecondaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, "phone" === platform ? Hct.isBlue(sourceColorHct.hue) ? 6 : 4 : Hct.isBlue(sourceColorHct.hue) ? 10 : 6);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 16);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				105,
				140,
				204,
				253,
				278,
				300,
				333,
				360
			], [
				-160,
				155,
				-100,
				96,
				-96,
				-156,
				-165,
				-160
			]), "phone" === platform && isDark ? 16 : 24);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				38,
				105,
				140,
				333,
				360
			], [
				-14,
				10,
				-14,
				10,
				-14
			]), "phone" === platform ? 56 : 36);
			default: return super.getSecondaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel);
		}
	}
	getTertiaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				38,
				105,
				161,
				204,
				278,
				333,
				360
			], [
				-32,
				26,
				10,
				-39,
				24,
				-15,
				-32
			]), "phone" === platform ? 20 : 36);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				20,
				71,
				161,
				333,
				360
			], [
				-40,
				48,
				-32,
				40,
				-32
			]), "phone" === platform ? 28 : 32);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				105,
				140,
				204,
				253,
				278,
				300,
				333,
				360
			], [
				-165,
				160,
				-105,
				101,
				-101,
				-160,
				-170,
				-165
			]), 48);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, [
				0,
				38,
				71,
				105,
				140,
				161,
				253,
				333,
				360
			], [
				-72,
				35,
				24,
				-24,
				62,
				50,
				62,
				-72
			]), 56);
			default: return super.getTertiaryPalette(variant, sourceColorHct, isDark, platform, contrastLevel);
		}
	}
	static getExpressiveNeutralHue(sourceColorHct) {
		return DynamicScheme.getRotatedHue(sourceColorHct, [
			0,
			71,
			124,
			253,
			278,
			300,
			360
		], [
			10,
			0,
			10,
			0,
			10,
			0
		]);
	}
	static getExpressiveNeutralChroma(sourceColorHct, isDark, platform) {
		const neutralHue = DynamicSchemePalettesDelegateImpl2025.getExpressiveNeutralHue(sourceColorHct);
		return "phone" === platform ? isDark ? Hct.isYellow(neutralHue) ? 6 : 14 : 18 : 12;
	}
	static getVibrantNeutralHue(sourceColorHct) {
		return DynamicScheme.getRotatedHue(sourceColorHct, [
			0,
			38,
			105,
			140,
			333,
			360
		], [
			-14,
			10,
			-14,
			10,
			-14
		]);
	}
	static getVibrantNeutralChroma(sourceColorHct, platform) {
		const neutralHue = DynamicSchemePalettesDelegateImpl2025.getVibrantNeutralHue(sourceColorHct);
		return "phone" === platform || Hct.isBlue(neutralHue) ? 28 : 20;
	}
	getNeutralPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, "phone" === platform ? 1.4 : 6);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, "phone" === platform ? 5 : 10);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(DynamicSchemePalettesDelegateImpl2025.getExpressiveNeutralHue(sourceColorHct), DynamicSchemePalettesDelegateImpl2025.getExpressiveNeutralChroma(sourceColorHct, isDark, platform));
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(DynamicSchemePalettesDelegateImpl2025.getVibrantNeutralHue(sourceColorHct), DynamicSchemePalettesDelegateImpl2025.getVibrantNeutralChroma(sourceColorHct, platform));
			default: return super.getNeutralPalette(variant, sourceColorHct, isDark, platform, contrastLevel);
		}
	}
	getNeutralVariantPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		switch (variant) {
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 2.2 * ("phone" === platform ? 1.4 : 6));
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(sourceColorHct.hue, 1.7 * ("phone" === platform ? 5 : 10));
			case Variant.EXPRESSIVE:
				const expressiveNeutralHue = DynamicSchemePalettesDelegateImpl2025.getExpressiveNeutralHue(sourceColorHct), expressiveNeutralChroma = DynamicSchemePalettesDelegateImpl2025.getExpressiveNeutralChroma(sourceColorHct, isDark, platform);
				return TonalPalette.fromHueAndChroma(expressiveNeutralHue, expressiveNeutralChroma * (expressiveNeutralHue >= 105 && expressiveNeutralHue < 125 ? 1.6 : 2.3));
			case Variant.VIBRANT:
				const vibrantNeutralHue = DynamicSchemePalettesDelegateImpl2025.getVibrantNeutralHue(sourceColorHct), vibrantNeutralChroma = DynamicSchemePalettesDelegateImpl2025.getVibrantNeutralChroma(sourceColorHct, platform);
				return TonalPalette.fromHueAndChroma(vibrantNeutralHue, 1.29 * vibrantNeutralChroma);
			default: return super.getNeutralVariantPalette(variant, sourceColorHct, isDark, platform, contrastLevel);
		}
	}
	getErrorPalette(variant, sourceColorHct, isDark, platform, contrastLevel) {
		const errorHue = DynamicScheme.getPiecewiseHue(sourceColorHct, [
			0,
			3,
			13,
			23,
			33,
			43,
			153,
			273,
			360
		], [
			12,
			22,
			32,
			12,
			22,
			32,
			22,
			12
		]);
		switch (variant) {
			case Variant.NEUTRAL: return TonalPalette.fromHueAndChroma(errorHue, "phone" === platform ? 50 : 40);
			case Variant.TONAL_SPOT: return TonalPalette.fromHueAndChroma(errorHue, "phone" === platform ? 60 : 48);
			case Variant.EXPRESSIVE: return TonalPalette.fromHueAndChroma(errorHue, "phone" === platform ? 64 : 48);
			case Variant.VIBRANT: return TonalPalette.fromHueAndChroma(errorHue, "phone" === platform ? 80 : 60);
			default: return super.getErrorPalette(variant, sourceColorHct, isDark, platform, contrastLevel);
		}
	}
};
var spec2021 = new DynamicSchemePalettesDelegateImpl2021();
var spec2025 = new DynamicSchemePalettesDelegateImpl2025();
function getSpec(specVersion) {
	return "2025" === specVersion ? spec2025 : spec2021;
}
var SchemeMonochrome = class extends DynamicScheme {
	constructor(sourceColorHct, isDark, contrastLevel, specVersion = DynamicScheme.DEFAULT_SPEC_VERSION, platform = DynamicScheme.DEFAULT_PLATFORM) {
		super({
			sourceColorHct,
			variant: Variant.MONOCHROME,
			contrastLevel,
			isDark,
			platform,
			specVersion
		});
	}
};
var SchemeTonalSpot = class extends DynamicScheme {
	constructor(sourceColorHct, isDark, contrastLevel, specVersion = DynamicScheme.DEFAULT_SPEC_VERSION, platform = DynamicScheme.DEFAULT_PLATFORM) {
		super({
			sourceColorHct,
			variant: Variant.TONAL_SPOT,
			contrastLevel,
			isDark,
			platform,
			specVersion
		});
	}
};
var SchemeVibrant = class extends DynamicScheme {
	constructor(sourceColorHct, isDark, contrastLevel, specVersion = DynamicScheme.DEFAULT_SPEC_VERSION, platform = DynamicScheme.DEFAULT_PLATFORM) {
		super({
			sourceColorHct,
			variant: Variant.VIBRANT,
			contrastLevel,
			isDark,
			platform,
			specVersion
		});
	}
};
function hexFromArgb(argb) {
	const r = redFromArgb(argb), g = greenFromArgb(argb), b = blueFromArgb(argb), outParts = [
		r.toString(16),
		g.toString(16),
		b.toString(16)
	];
	for (const [i, part] of outParts.entries()) 1 === part.length && (outParts[i] = "0" + part);
	return "#" + outParts.join("");
}
function argbFromHex(hex) {
	const isThree = 3 === (hex = hex.replace("#", "")).length, isSix = 6 === hex.length, isEight = 8 === hex.length;
	if (!isThree && !isSix && !isEight) throw new Error("unexpected hex " + hex);
	let r = 0, g = 0, b = 0;
	return isThree ? (r = parseIntHex(hex.slice(0, 1).repeat(2)), g = parseIntHex(hex.slice(1, 2).repeat(2)), b = parseIntHex(hex.slice(2, 3).repeat(2))) : isSix ? (r = parseIntHex(hex.slice(0, 2)), g = parseIntHex(hex.slice(2, 4)), b = parseIntHex(hex.slice(4, 6))) : isEight && (r = parseIntHex(hex.slice(2, 4)), g = parseIntHex(hex.slice(4, 6)), b = parseIntHex(hex.slice(6, 8))), (255 << 24 | (255 & r) << 16 | (255 & g) << 8 | 255 & b) >>> 0;
}
function parseIntHex(value) {
	return parseInt(value, 16);
}
function toRGBA(d) {
	const r = Math.round;
	const l = d.length;
	const rgba = {};
	if (d.slice(0, 3).toLowerCase() === "rgb") {
		d = d.replace(" ", "").split(",");
		rgba[0] = parseInt(d[0].slice(d[3].toLowerCase() === "a" ? 5 : 4), 10);
		rgba[1] = parseInt(d[1], 10);
		rgba[2] = parseInt(d[2], 10);
		rgba[3] = d[3] ? parseFloat(d[3]) : -1;
	} else {
		if (l < 6) d = parseInt(String(d[1]) + d[1] + d[2] + d[2] + d[3] + d[3] + (l > 4 ? String(d[4]) + d[4] : ""), 16);
		else d = parseInt(d.slice(1), 16);
		rgba[0] = d >> 16 & 255;
		rgba[1] = d >> 8 & 255;
		rgba[2] = d & 255;
		rgba[3] = l === 9 || l === 5 ? r((d >> 24 & 255) / 255 * 1e4) / 1e4 : -1;
	}
	return rgba;
}
function blend(from, to, p = .5) {
	const r = Math.round;
	from = from.trim();
	to = to.trim();
	p = p < 0 ? p * -1 : p;
	const f = toRGBA(from);
	const t = toRGBA(to);
	if (to[0] === "r") return "rgb" + (to[3] === "a" ? "a(" : "(") + r((t[0] - f[0]) * p + f[0]) + "," + r((t[1] - f[1]) * p + f[1]) + "," + r((t[2] - f[2]) * p + f[2]) + (f[3] < 0 && t[3] < 0 ? "" : "," + (f[3] > -1 && t[3] > -1 ? r(((t[3] - f[3]) * p + f[3]) * 1e4) / 1e4 : t[3] < 0 ? f[3] : t[3])) + ")";
	return "#" + (4294967296 + (f[3] > -1 && t[3] > -1 ? r(((t[3] - f[3]) * p + f[3]) * 255) : t[3] > -1 ? r(t[3] * 255) : f[3] > -1 ? r(f[3] * 255) : 255) * 16777216 + r((t[0] - f[0]) * p + f[0]) * 65536 + r((t[1] - f[1]) * p + f[1]) * 256 + r((t[2] - f[2]) * p + f[2])).toString(16).slice(f[3] > -1 || t[3] > -1 ? 1 : 3);
}
var monochromeCached = null;
var cachedColors = {};
var materialColors = (hexColor = "", colorScheme = "default") => {
	const cacheKey = `${hexColor}-${colorScheme}`;
	if (cachedColors[cacheKey]) return cachedColors[cacheKey];
	if (monochromeCached && colorScheme.includes("monochrome")) {
		const defaultColors = materialColors(hexColor, colorScheme === "monochrome" ? "default" : "vibrant");
		cachedColors[cacheKey] = {
			light: {
				...defaultColors.light,
				...monochromeCached.light
			},
			dark: {
				...defaultColors.dark,
				...monochromeCached.dark
			}
		};
		return cachedColors[cacheKey];
	}
	const sourceColor = argbFromHex(`#${hexColor.replace("#", "")}`);
	let lightScheme;
	let darkScheme;
	const hctColor = Hct.fromInt(sourceColor);
	if (colorScheme === "default") {
		lightScheme = new SchemeTonalSpot(hctColor, false, 0, "2025");
		darkScheme = new SchemeTonalSpot(hctColor, true, 0, "2025");
	}
	if (colorScheme === "vibrant") {
		lightScheme = new SchemeVibrant(hctColor, false, 0, "2025");
		darkScheme = new SchemeVibrant(hctColor, true, 0, "2025");
	}
	if (colorScheme.includes("monochrome")) {
		lightScheme = new SchemeMonochrome(hctColor, false, 0, "2025");
		darkScheme = new SchemeMonochrome(hctColor, true, 0, "2025");
	}
	const getColorName = (name) => {
		let newName = name;
		if (name === "surface_dim") newName = "surface_variant";
		if (name === "surface_container_low") newName = "surface_1";
		if (name === "surface_container") newName = "surface_2";
		if (name === "surface_container_high") newName = "surface_3";
		if (name === "surface_container_highest") newName = "surface_4";
		return newName;
	};
	const theme = {
		light: {},
		dark: {}
	};
	lightScheme.colors.allColors.forEach((color) => {
		const name = getColorName(color.name);
		const argb = color.getArgb(lightScheme);
		theme.light[name] = argb;
	});
	darkScheme.colors.allColors.forEach((color) => {
		const name = getColorName(color.name);
		const argb = color.getArgb(darkScheme);
		theme.dark[name] = argb;
	});
	theme.light.surface_5 = argbFromHex(blend(hexFromArgb(theme.light.surface_4), hexFromArgb(theme.light.primary), .05));
	theme.dark.surface_5 = argbFromHex(blend(hexFromArgb(theme.dark.surface_4), hexFromArgb(theme.dark.primary), .05));
	const name = (n) => {
		return n.replace(/_/g, "-");
	};
	const shouldKeep = (prop) => {
		const foreground = [
			"inverse_primary",
			"primary",
			"on_primary",
			"primary_container",
			"on_primary_container",
			"secondary",
			"on_secondary",
			"secondary_container",
			"on_secondary_container",
			"outline",
			"outline_variant"
		];
		const background = [
			"on_surface",
			"on_surface_variant",
			"inverse_on_surface",
			"inverse_surface",
			"surface",
			"surface_variant",
			"surface_1",
			"surface_2",
			"surface_3",
			"surface_4",
			"surface_5"
		];
		return (colorScheme === "default" ? [...foreground, ...background] : colorScheme === "vibrant" ? [...foreground, ...background] : background).includes(prop);
	};
	const light = {};
	const dark = {};
	Object.keys(theme.light).forEach((prop) => {
		if (!shouldKeep(prop)) return;
		light[name(`--f7-md-${prop}`)] = hexFromArgb(theme.light[prop]);
	});
	Object.keys(theme.dark).forEach((prop) => {
		if (!shouldKeep(prop)) return;
		dark[name(`--f7-md-${prop}`)] = hexFromArgb(theme.dark[prop]);
	});
	if (colorScheme.includes("monochrome")) {
		monochromeCached = {
			light,
			dark
		};
		const defaultColors = materialColors(hexColor, colorScheme === "monochrome" ? "default" : "vibrant");
		cachedColors[cacheKey] = {
			light: {
				...defaultColors.light,
				...light
			},
			dark: {
				...defaultColors.dark,
				...dark
			}
		};
		return cachedColors[cacheKey];
	}
	cachedColors[cacheKey] = {
		light,
		dark
	};
	return cachedColors[cacheKey];
};
var utils_exports = /* @__PURE__ */ __exportAll({
	bindMethods: () => bindMethods,
	cancelAnimationFrame: () => cancelAnimationFrame$1,
	colorHexToRgb: () => colorHexToRgb,
	colorHsbToHsl: () => colorHsbToHsl,
	colorHslToHsb: () => colorHslToHsb,
	colorHslToRgb: () => colorHslToRgb,
	colorRgbToHex: () => colorRgbToHex,
	colorRgbToHsl: () => colorRgbToHsl,
	colorThemeCSSProperties: () => colorThemeCSSProperties,
	colorThemeCSSStyles: () => colorThemeCSSStyles,
	deleteProps: () => deleteProps,
	eventNameToColonCase: () => eventNameToColonCase,
	extend: () => extend$1,
	flattenArray: () => flattenArray,
	getTranslate: () => getTranslate,
	id: () => id,
	iosPreloaderContent: () => iosPreloaderContent,
	isObject: () => isObject$1,
	mdPreloaderContent: () => mdPreloaderContent,
	merge: () => merge,
	nextFrame: () => nextFrame$1,
	nextTick: () => nextTick,
	now: () => now$1,
	parseUrlQuery: () => parseUrlQuery,
	requestAnimationFrame: () => requestAnimationFrame$1,
	serializeObject: () => serializeObject,
	uniqueNumber: () => uniqueNumber
});
var uniqueNum = 0;
function uniqueNumber() {
	uniqueNum += 1;
	return uniqueNum;
}
function id(mask = "xxxxxxxxxx", map = "0123456789abcdef") {
	const length = map.length;
	return mask.replace(/x/g, () => map[Math.floor(Math.random() * length)]);
}
var mdPreloaderContent = `
  <span class="preloader-inner">
    <svg viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="16"></circle>
    </svg>
  </span>
`.trim();
var iosPreloaderContent = `
  <span class="preloader-inner">
    ${[
	0,
	1,
	2,
	3,
	4,
	5,
	6,
	7
].map(() => "<span class=\"preloader-inner-line\"></span>").join("")}
  </span>
`.trim();
function eventNameToColonCase(eventName) {
	let hasColon;
	return eventName.split("").map((char, index) => {
		if (char.match(/[A-Z]/) && index !== 0 && !hasColon) {
			hasColon = true;
			return `:${char.toLowerCase()}`;
		}
		return char.toLowerCase();
	}).join("");
}
function deleteProps(obj) {
	const object = obj;
	Object.keys(object).forEach((key) => {
		try {
			object[key] = null;
		} catch (e) {}
		try {
			delete object[key];
		} catch (e) {}
	});
}
function requestAnimationFrame$1(callback) {
	return getWindow().requestAnimationFrame(callback);
}
function cancelAnimationFrame$1(frameId) {
	return getWindow().cancelAnimationFrame(frameId);
}
function nextTick(callback, delay = 0) {
	return setTimeout(callback, delay);
}
function nextFrame$1(callback) {
	return requestAnimationFrame$1(() => {
		requestAnimationFrame$1(callback);
	});
}
function now$1() {
	return Date.now();
}
function parseUrlQuery(url) {
	const window = getWindow();
	const query = {};
	let urlToParse = url || window.location.href;
	let i;
	let params;
	let param;
	let length;
	if (typeof urlToParse === "string" && urlToParse.length) {
		urlToParse = urlToParse.indexOf("?") > -1 ? urlToParse.replace(/\S*\?/, "") : "";
		params = urlToParse.split("&").filter((paramsPart) => paramsPart !== "");
		length = params.length;
		for (i = 0; i < length; i += 1) {
			param = params[i].replace(/#\S+/g, "").split("=");
			query[decodeURIComponent(param[0])] = typeof param[1] === "undefined" ? void 0 : decodeURIComponent(param.slice(1).join("=")) || "";
		}
	}
	return query;
}
function getTranslate(el, axis = "x") {
	const window = getWindow();
	let matrix;
	let curTransform;
	let transformMatrix;
	const curStyle = window.getComputedStyle(el, null);
	if (window.WebKitCSSMatrix) {
		curTransform = curStyle.transform || curStyle.webkitTransform;
		if (curTransform.split(",").length > 6) curTransform = curTransform.split(", ").map((a) => a.replace(",", ".")).join(", ");
		transformMatrix = new window.WebKitCSSMatrix(curTransform === "none" ? "" : curTransform);
	} else {
		transformMatrix = curStyle.MozTransform || curStyle.OTransform || curStyle.MsTransform || curStyle.msTransform || curStyle.transform || curStyle.getPropertyValue("transform").replace("translate(", "matrix(1, 0, 0, 1,");
		matrix = transformMatrix.toString().split(",");
	}
	if (axis === "x") {
		if (window.WebKitCSSMatrix) curTransform = transformMatrix.m41;
		else if (matrix.length === 16) curTransform = parseFloat(matrix[12]);
		else curTransform = parseFloat(matrix[4]);
	}
	if (axis === "y") {
		if (window.WebKitCSSMatrix) curTransform = transformMatrix.m42;
		else if (matrix.length === 16) curTransform = parseFloat(matrix[13]);
		else curTransform = parseFloat(matrix[5]);
	}
	return curTransform || 0;
}
function serializeObject(obj, parents = []) {
	if (typeof obj === "string") return obj;
	const resultArray = [];
	const separator = "&";
	let newParents;
	function varName(name) {
		if (parents.length > 0) {
			let parentParts = "";
			for (let j = 0; j < parents.length; j += 1) if (j === 0) parentParts += parents[j];
			else parentParts += `[${encodeURIComponent(parents[j])}]`;
			return `${parentParts}[${encodeURIComponent(name)}]`;
		}
		return encodeURIComponent(name);
	}
	function varValue(value) {
		return encodeURIComponent(value);
	}
	Object.keys(obj).forEach((prop) => {
		let toPush;
		if (Array.isArray(obj[prop])) {
			toPush = [];
			for (let i = 0; i < obj[prop].length; i += 1) if (!Array.isArray(obj[prop][i]) && typeof obj[prop][i] === "object") {
				newParents = parents.slice();
				newParents.push(prop);
				newParents.push(String(i));
				toPush.push(serializeObject(obj[prop][i], newParents));
			} else toPush.push(`${varName(prop)}[]=${varValue(obj[prop][i])}`);
			if (toPush.length > 0) resultArray.push(toPush.join(separator));
		} else if (obj[prop] === null || obj[prop] === "") resultArray.push(`${varName(prop)}=`);
		else if (typeof obj[prop] === "object") {
			newParents = parents.slice();
			newParents.push(prop);
			toPush = serializeObject(obj[prop], newParents);
			if (toPush !== "") resultArray.push(toPush);
		} else if (typeof obj[prop] !== "undefined" && obj[prop] !== "") resultArray.push(`${varName(prop)}=${varValue(obj[prop])}`);
		else if (obj[prop] === "") resultArray.push(varName(prop));
	});
	return resultArray.join(separator);
}
function isObject$1(o) {
	return typeof o === "object" && o !== null && o.constructor && o.constructor === Object;
}
function merge(...args) {
	const to = args[0];
	args.splice(0, 1);
	const from = args;
	for (let i = 0; i < from.length; i += 1) {
		const nextSource = args[i];
		if (nextSource !== void 0 && nextSource !== null) {
			const keysArray = Object.keys(Object(nextSource));
			for (let nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex += 1) {
				const nextKey = keysArray[nextIndex];
				if (nextKey === "__proto__" || nextKey === "constructor" || nextKey === "prototype") continue;
				const desc = Object.getOwnPropertyDescriptor(nextSource, nextKey);
				if (desc !== void 0 && desc.enumerable) to[nextKey] = nextSource[nextKey];
			}
		}
	}
	return to;
}
function extend$1(...args) {
	let deep = true;
	let to;
	let from;
	if (typeof args[0] === "boolean") {
		deep = args[0];
		to = args[1];
		args.splice(0, 2);
		from = args;
	} else {
		to = args[0];
		args.splice(0, 1);
		from = args;
	}
	for (let i = 0; i < from.length; i += 1) {
		const nextSource = args[i];
		if (nextSource !== void 0 && nextSource !== null) {
			const keysArray = Object.keys(Object(nextSource));
			for (let nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex += 1) {
				const nextKey = keysArray[nextIndex];
				if (nextKey === "__proto__" || nextKey === "constructor" || nextKey === "prototype") continue;
				const desc = Object.getOwnPropertyDescriptor(nextSource, nextKey);
				if (desc !== void 0 && desc.enumerable) {
					if (!deep) to[nextKey] = nextSource[nextKey];
					else if (isObject$1(to[nextKey]) && isObject$1(nextSource[nextKey])) extend$1(to[nextKey], nextSource[nextKey]);
					else if (!isObject$1(to[nextKey]) && isObject$1(nextSource[nextKey])) {
						to[nextKey] = {};
						extend$1(to[nextKey], nextSource[nextKey]);
					} else to[nextKey] = nextSource[nextKey];
				}
			}
		}
	}
	return to;
}
function colorHexToRgb(hex) {
	const h = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (m, r, g, b) => r + r + g + g + b + b);
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
	return result ? result.slice(1).map((n) => parseInt(n, 16)) : null;
}
function colorRgbToHex(r, g, b) {
	return `#${[
		r,
		g,
		b
	].map((n) => {
		const hex = n.toString(16);
		return hex.length === 1 ? `0${hex}` : hex;
	}).join("")}`;
}
function colorRgbToHsl(r, g, b) {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h;
	if (d === 0) h = 0;
	else if (max === r) h = (g - b) / d % 6;
	else if (max === g) h = (b - r) / d + 2;
	else if (max === b) h = (r - g) / d + 4;
	const l = (min + max) / 2;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	if (h < 0) h = 6 + h;
	return [
		h * 60,
		s,
		l
	];
}
function colorHslToRgb(h, s, l) {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = h / 60;
	const x = c * (1 - Math.abs(hp % 2 - 1));
	let rgb1;
	if (Number.isNaN(h) || typeof h === "undefined") rgb1 = [
		0,
		0,
		0
	];
	else if (hp <= 1) rgb1 = [
		c,
		x,
		0
	];
	else if (hp <= 2) rgb1 = [
		x,
		c,
		0
	];
	else if (hp <= 3) rgb1 = [
		0,
		c,
		x
	];
	else if (hp <= 4) rgb1 = [
		0,
		x,
		c
	];
	else if (hp <= 5) rgb1 = [
		x,
		0,
		c
	];
	else if (hp <= 6) rgb1 = [
		c,
		0,
		x
	];
	const m = l - c / 2;
	return rgb1.map((n) => Math.max(0, Math.min(255, Math.round(255 * (n + m)))));
}
function colorHsbToHsl(h, s, b) {
	const HSL = {
		h,
		s: 0,
		l: 0
	};
	const HSB = {
		h,
		s,
		b
	};
	HSL.l = (2 - HSB.s) * HSB.b / 2;
	HSL.s = HSL.l && HSL.l < 1 ? HSB.s * HSB.b / (HSL.l < .5 ? HSL.l * 2 : 2 - HSL.l * 2) : HSL.s;
	return [
		HSL.h,
		HSL.s,
		HSL.l
	];
}
function colorHslToHsb(h, s, l) {
	const HSB = {
		h,
		s: 0,
		b: 0
	};
	const HSL = {
		h,
		s,
		l
	};
	const t = HSL.s * (HSL.l < .5 ? HSL.l : 1 - HSL.l);
	HSB.b = HSL.l + t;
	HSB.s = HSL.l > 0 ? 2 * t / HSB.b : HSB.s;
	return [
		HSB.h,
		HSB.s,
		HSB.b
	];
}
var getShadeTintColors = (rgb) => {
	const hsl = colorRgbToHsl(...rgb);
	const hslShade = [
		hsl[0],
		hsl[1],
		Math.max(0, hsl[2] - .08)
	];
	const hslTint = [
		hsl[0],
		hsl[1],
		Math.max(0, hsl[2] + .08)
	];
	return {
		shade: colorRgbToHex(...colorHslToRgb(...hslShade)),
		tint: colorRgbToHex(...colorHslToRgb(...hslTint))
	};
};
function colorThemeCSSProperties(...args) {
	let hex;
	let rgb;
	let mdColorScheme;
	if (args.length === 1) {
		hex = args[0];
		rgb = colorHexToRgb(hex);
	} else if (args.length === 2) {
		hex = args[0];
		rgb = colorHexToRgb(hex);
		mdColorScheme = args[1] || "default";
	} else if (args.length === 3) {
		rgb = args;
		hex = colorRgbToHex(...rgb);
	} else if (args.length === 4) {
		rgb = args.slice(0, 3);
		hex = colorRgbToHex(...rgb);
		mdColorScheme = args[3] || "default";
	}
	if (!rgb) return {};
	const { light, dark } = materialColors(hex, mdColorScheme);
	const shadeTintIos = getShadeTintColors(rgb);
	const shadeTintMdLight = getShadeTintColors(colorHexToRgb(light["--f7-md-primary"]));
	const shadeTintMdDark = getShadeTintColors(colorHexToRgb(dark["--f7-md-primary"]));
	Object.keys(light).forEach((key) => {
		if (key.includes("surface-") && !key.includes("-rgb")) light[`${key}-rgb`] = colorHexToRgb(light[key]);
	});
	Object.keys(dark).forEach((key) => {
		if (key.includes("surface-") && !key.includes("-rgb")) dark[`${key}-rgb`] = colorHexToRgb(dark[key]);
	});
	return {
		ios: {
			"--f7-theme-color": "var(--f7-ios-primary)",
			"--f7-theme-color-rgb": "var(--f7-ios-primary-rgb)",
			"--f7-theme-color-shade": "var(--f7-ios-primary-shade)",
			"--f7-theme-color-tint": "var(--f7-ios-primary-tint)"
		},
		md: {
			"--f7-theme-color": "var(--f7-md-primary)",
			"--f7-theme-color-rgb": "var(--f7-md-primary-rgb)",
			"--f7-theme-color-shade": "var(--f7-md-primary-shade)",
			"--f7-theme-color-tint": "var(--f7-md-primary-tint)"
		},
		light: {
			"--f7-ios-primary": hex,
			"--f7-ios-primary-shade": shadeTintIos.shade,
			"--f7-ios-primary-tint": shadeTintIos.tint,
			"--f7-ios-primary-rgb": rgb.join(", "),
			"--f7-md-primary-shade": shadeTintMdLight.shade,
			"--f7-md-primary-tint": shadeTintMdLight.tint,
			"--f7-md-primary-rgb": colorHexToRgb(light["--f7-md-primary"]).join(", "),
			...light
		},
		dark: {
			"--f7-md-primary-shade": shadeTintMdDark.shade,
			"--f7-md-primary-tint": shadeTintMdDark.tint,
			"--f7-md-primary-rgb": colorHexToRgb(dark["--f7-md-primary"]).join(", "),
			...dark
		}
	};
}
function bindMethods(instance, obj) {
	Object.keys(obj).forEach((key) => {
		if (isObject$1(obj[key])) Object.keys(obj[key]).forEach((subKey) => {
			if (typeof obj[key][subKey] === "function") obj[key][subKey] = obj[key][subKey].bind(instance);
		});
		instance[key] = obj[key];
	});
}
function flattenArray(...args) {
	const arr = [];
	args.forEach((arg) => {
		if (Array.isArray(arg)) arr.push(...flattenArray(...arg));
		else arr.push(arg);
	});
	return arr;
}
function colorThemeCSSStyles(colors = {}, mdColorScheme = "default") {
	const stringifyObject = (obj) => {
		let res = "";
		Object.keys(obj).forEach((key) => {
			res += `${key}:${obj[key]};`;
		});
		return res;
	};
	const colorVars = colorThemeCSSProperties(colors.primary, mdColorScheme);
	const primary = [
		`:root{`,
		stringifyObject(colorVars.light),
		`--swiper-theme-color:var(--f7-theme-color);`,
		...Object.keys(colors).map((colorName) => `--f7-color-${colorName}: ${colors[colorName]};`),
		`}`,
		`.dark{`,
		stringifyObject(colorVars.dark),
		`}`,
		`.ios, .ios .dark{`,
		stringifyObject(colorVars.ios),
		"}",
		`.md, .md .dark{`,
		stringifyObject(colorVars.md),
		"}"
	].join("");
	const restVars = {};
	Object.keys(colors).forEach((colorName) => {
		const colorValue = colors[colorName];
		restVars[colorName] = colorThemeCSSProperties(colorValue, mdColorScheme);
	});
	let rest = "";
	Object.keys(colors).forEach((colorName) => {
		const { light, dark, ios, md } = restVars[colorName];
		const whiteColorVars = `
    --f7-ios-primary: #ffffff;
    --f7-ios-primary-shade: #ebebeb;
    --f7-ios-primary-tint: #ffffff;
    --f7-ios-primary-rgb: 255, 255, 255;
    --f7-md-primary-shade: #eee;
    --f7-md-primary-tint: #fff;
    --f7-md-primary-rgb: 255, 255, 255;
    --f7-md-primary: #fff;
    --f7-md-on-primary: #000;
    --f7-md-primary-container: #fff;
    --f7-md-on-primary-container: #000;
    --f7-md-secondary: #fff;
    --f7-md-on-secondary: #000;
    --f7-md-secondary-container: #555;
    --f7-md-on-secondary-container: #fff;
    --f7-md-surface: #fff;
    --f7-md-on-surface: #000;
    --f7-md-surface-variant: #333;
    --f7-md-on-surface-variant: #fff;
    --f7-md-outline: #fff;
    --f7-md-outline-variant: #fff;
    --f7-md-inverse-surface: #000;
    --f7-md-inverse-on-surface: #fff;
    --f7-md-inverse-primary: #000;
    --f7-md-surface-1: #f8f8f8;
    --f7-md-surface-2: #f1f1f1;
    --f7-md-surface-3: #e7e7e7;
    --f7-md-surface-4: #e1e1e1;
    --f7-md-surface-5: #d7d7d7;
    --f7-md-surface-variant-rgb: 51, 51, 51;
    --f7-md-on-surface-variant-rgb: 255, 255, 255;
    --f7-md-surface-1-rgb: 248, 248, 248;
    --f7-md-surface-2-rgb: 241, 241, 241;
    --f7-md-surface-3-rgb: 231, 231, 231;
    --f7-md-surface-4-rgb: 225, 225, 225;
    --f7-md-surface-5-rgb: 215, 215, 215;
    `;
		const blackColorVars = `
    --f7-ios-primary: #000;
    --f7-ios-primary-shade: #000;
    --f7-ios-primary-tint: #232323;
    --f7-ios-primary-rgb: 0, 0, 0;
    --f7-md-primary-shade: #000;
    --f7-md-primary-tint: #232323;
    --f7-md-primary-rgb: 0, 0, 0;
    --f7-md-primary: #000;
    --f7-md-on-primary: #fff;
    --f7-md-primary-container: #000;
    --f7-md-on-primary-container: #fff;
    --f7-md-secondary: #000;
    --f7-md-on-secondary: #fff;
    --f7-md-secondary-container: #aaa;
    --f7-md-on-secondary-container: #000;
    --f7-md-surface: #000;
    --f7-md-on-surface: #fff;
    --f7-md-surface-variant: #ccc;
    --f7-md-on-surface-variant: #000;
    --f7-md-outline: #000;
    --f7-md-outline-variant: #000;
    --f7-md-inverse-surface: #fff;
    --f7-md-inverse-on-surface: #000;
    --f7-md-inverse-primary: #fff;
    --f7-md-surface-1: #070707;
    --f7-md-surface-2: #161616;
    --f7-md-surface-3: #232323;
    --f7-md-surface-4: #303030;
    --f7-md-surface-5: #373737;
    --f7-md-surface-variant-rgb: 204, 204, 204;
    --f7-md-on-surface-variant-rgb: 0, 0, 0;
    --f7-md-surface-1-rgb: 7, 7, 7;
    --f7-md-surface-2-rgb: 22, 22, 22;
    --f7-md-surface-3-rgb: 35, 35, 35;
    --f7-md-surface-4-rgb: 48, 48, 48;
    --f7-md-surface-5-rgb: 55, 55, 55;
    `;
		const lightString = colorName === "white" ? whiteColorVars : colorName === "black" ? blackColorVars : stringifyObject(light);
		const darkString = colorName === "white" ? whiteColorVars : colorName === "black" ? blackColorVars : stringifyObject(dark);
		rest += [
			`.color-${colorName} {`,
			lightString,
			`--swiper-theme-color: var(--f7-theme-color);`,
			`}`,
			`.color-${colorName}.dark, .color-${colorName} .dark, .dark .color-${colorName} {`,
			darkString,
			`--swiper-theme-color: var(--f7-theme-color);`,
			`}`,
			`.ios .color-${colorName}, .ios.color-${colorName}, .ios .dark .color-${colorName}, .ios .dark.color-${colorName} {`,
			stringifyObject(ios),
			`}`,
			`.md .color-${colorName}, .md.color-${colorName}, .md .dark .color-${colorName}, .md .dark.color-${colorName} {`,
			stringifyObject(md),
			`}`,
			`.text-color-${colorName} {`,
			`--f7-theme-color-text-color: ${colors[colorName]};`,
			`}`,
			`.bg-color-${colorName} {`,
			`--f7-theme-color-bg-color: ${colors[colorName]};`,
			`}`,
			`.border-color-${colorName} {`,
			`--f7-theme-color-border-color: ${colors[colorName]};`,
			`}`,
			`.ripple-color-${colorName} {`,
			`--f7-theme-color-ripple-color: rgba(${light["--f7-ios-primary-rgb"]}, 0.3);`,
			`}`
		].join("");
	});
	return `${primary}${rest}`;
}
var support;
function calcSupport() {
	const window = getWindow();
	const document = getDocument();
	return { touch: !!("ontouchstart" in window || window.DocumentTouch && document instanceof window.DocumentTouch) };
}
function getSupport() {
	if (!support) support = calcSupport();
	return support;
}
var deviceCalculated;
function calcDevice({ userAgent } = {}) {
	const support = getSupport();
	const window = getWindow();
	const platform = window.navigator.platform;
	const ua = userAgent || window.navigator.userAgent;
	const device = {
		ios: false,
		android: false,
		androidChrome: false,
		desktop: false,
		iphone: false,
		ipod: false,
		ipad: false,
		edge: false,
		ie: false,
		firefox: false,
		macos: false,
		windows: false,
		cordova: !!window.cordova,
		electron: false,
		capacitor: !!window.Capacitor,
		nwjs: false
	};
	const screenWidth = window.screen.width;
	const screenHeight = window.screen.height;
	const android = ua.match(/(Android);?[\s\/]+([\d.]+)?/);
	let ipad = ua.match(/(iPad).*OS\s([\d_]+)/);
	const ipod = ua.match(/(iPod)(.*OS\s([\d_]+))?/);
	const iphone = !ipad && ua.match(/(iPhone\sOS|iOS|iPhone;\sCPU\sOS)\s([\d_]+)/);
	const ie = ua.indexOf("MSIE ") >= 0 || ua.indexOf("Trident/") >= 0;
	const edge = ua.indexOf("Edge/") >= 0;
	const firefox = ua.indexOf("Gecko/") >= 0 && ua.indexOf("Firefox/") >= 0;
	const windows = platform === "Win32";
	const electron = ua.toLowerCase().indexOf("electron") >= 0;
	const nwjs = typeof nw !== "undefined" && typeof process !== "undefined" && typeof process.versions !== "undefined" && typeof process.versions.nw !== "undefined";
	let macos = platform === "MacIntel";
	if (!ipad && macos && support.touch && [
		"1024x1366",
		"1366x1024",
		"834x1194",
		"1194x834",
		"834x1112",
		"1112x834",
		"768x1024",
		"1024x768",
		"820x1180",
		"1180x820",
		"810x1080",
		"1080x810"
	].indexOf(`${screenWidth}x${screenHeight}`) >= 0) {
		ipad = ua.match(/(Version)\/([\d.]+)/);
		if (!ipad) ipad = [
			0,
			1,
			"13_0_0"
		];
		macos = false;
	}
	device.ie = ie;
	device.edge = edge;
	device.firefox = firefox;
	if (android) {
		device.os = "android";
		device.osVersion = android[2];
		device.android = true;
		device.androidChrome = ua.toLowerCase().indexOf("chrome") >= 0;
	}
	if (ipad || iphone || ipod) {
		device.os = "ios";
		device.ios = true;
	}
	if (iphone && !ipod) {
		device.osVersion = iphone[2].replace(/_/g, ".");
		device.iphone = true;
	}
	if (ipad) {
		device.osVersion = ipad[2].replace(/_/g, ".");
		device.ipad = true;
	}
	if (ipod) {
		device.osVersion = ipod[3] ? ipod[3].replace(/_/g, ".") : null;
		device.ipod = true;
	}
	if (device.ios && device.osVersion && ua.indexOf("Version/") >= 0) {
		if (device.osVersion.split(".")[0] === "10") device.osVersion = ua.toLowerCase().split("version/")[1].split(" ")[0];
	}
	device.webView = !!((iphone || ipad || ipod) && (ua.match(/.*AppleWebKit(?!.*Safari)/i) || window.navigator.standalone)) || window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
	device.webview = device.webView;
	device.standalone = device.webView;
	device.desktop = !(device.ios || device.android) || electron || nwjs;
	if (device.desktop) {
		device.electron = electron;
		device.nwjs = nwjs;
		device.macos = macos;
		device.windows = windows;
		if (device.macos) device.os = "macos";
		if (device.windows) device.os = "windows";
	}
	device.pixelRatio = window.devicePixelRatio || 1;
	const DARK = "(prefers-color-scheme: dark)";
	const LIGHT = "(prefers-color-scheme: light)";
	device.prefersColorScheme = function prefersColorTheme() {
		let theme;
		if (window.matchMedia && window.matchMedia(LIGHT).matches) theme = "light";
		if (window.matchMedia && window.matchMedia(DARK).matches) theme = "dark";
		return theme;
	};
	return device;
}
var IS_BROWSER = (() => {
	const document = getDocument();
	try {
		return Boolean(document && document.body && document.body.getBoundingClientRect && document.body.getBoundingClientRect().width > 0);
	} catch (e) {
		return false;
	}
})();
function getDevice(overrides = {}, reset = IS_BROWSER) {
	if (!deviceCalculated || reset) deviceCalculated = calcDevice(overrides);
	return deviceCalculated;
}
var EventsClass = class {
	constructor(parents = []) {
		const self = this;
		self.eventsParents = parents;
		self.eventsListeners = {};
	}
	on(events, handler, priority) {
		const self = this;
		if (typeof handler !== "function") return self;
		const method = priority ? "unshift" : "push";
		events.split(" ").forEach((event) => {
			if (!self.eventsListeners[event]) self.eventsListeners[event] = [];
			self.eventsListeners[event][method](handler);
		});
		return self;
	}
	once(events, handler, priority) {
		const self = this;
		if (typeof handler !== "function") return self;
		function onceHandler(...args) {
			self.off(events, onceHandler);
			if (onceHandler.f7proxy) delete onceHandler.f7proxy;
			handler.apply(self, args);
		}
		onceHandler.f7proxy = handler;
		return self.on(events, onceHandler, priority);
	}
	off(events, handler) {
		const self = this;
		if (!self.eventsListeners) return self;
		events.split(" ").forEach((event) => {
			if (typeof handler === "undefined") self.eventsListeners[event] = [];
			else if (self.eventsListeners[event]) self.eventsListeners[event].forEach((eventHandler, index) => {
				if (eventHandler === handler || eventHandler.f7proxy && eventHandler.f7proxy === handler) self.eventsListeners[event].splice(index, 1);
			});
		});
		return self;
	}
	emit(...args) {
		const self = this;
		if (!self.eventsListeners) return self;
		let events;
		let data;
		let context;
		let eventsParents;
		if (typeof args[0] === "string" || Array.isArray(args[0])) {
			events = args[0];
			data = args.slice(1, args.length);
			context = self;
			eventsParents = self.eventsParents;
		} else {
			events = args[0].events;
			data = args[0].data;
			context = args[0].context || self;
			eventsParents = args[0].local ? [] : args[0].parents || self.eventsParents;
		}
		const eventsArray = Array.isArray(events) ? events : events.split(" ");
		const localEvents = eventsArray.map((eventName) => eventName.replace("local::", ""));
		const parentEvents = eventsArray.filter((eventName) => eventName.indexOf("local::") < 0);
		localEvents.forEach((event) => {
			if (self.eventsListeners && self.eventsListeners[event]) {
				const handlers = [];
				self.eventsListeners[event].forEach((eventHandler) => {
					handlers.push(eventHandler);
				});
				handlers.forEach((eventHandler) => {
					eventHandler.apply(context, data);
				});
			}
		});
		if (eventsParents && eventsParents.length > 0) eventsParents.forEach((eventsParent) => {
			eventsParent.emit(parentEvents, ...data);
		});
		return self;
	}
};
var Framework7Class = class extends EventsClass {
	constructor(params = {}, parents = []) {
		super(parents);
		const self = this;
		self.params = params;
		if (self.params && self.params.on) Object.keys(self.params.on).forEach((eventName) => {
			self.on(eventName, self.params.on[eventName]);
		});
	}
	useModuleParams(module, instanceParams) {
		if (module.params) {
			const originalParams = {};
			Object.keys(module.params).forEach((paramKey) => {
				if (typeof instanceParams[paramKey] === "undefined") return;
				originalParams[paramKey] = extend$1({}, instanceParams[paramKey]);
			});
			extend$1(instanceParams, module.params);
			Object.keys(originalParams).forEach((paramKey) => {
				extend$1(instanceParams[paramKey], originalParams[paramKey]);
			});
		}
	}
	useModulesParams(instanceParams) {
		const instance = this;
		if (!instance.modules) return;
		Object.keys(instance.modules).forEach((moduleName) => {
			const module = instance.modules[moduleName];
			if (module.params) extend$1(instanceParams, module.params);
		});
	}
	useModule(moduleName = "", moduleParams = {}) {
		const instance = this;
		if (!instance.modules) return;
		const module = typeof moduleName === "string" ? instance.modules[moduleName] : moduleName;
		if (!module) return;
		if (module.instance) Object.keys(module.instance).forEach((modulePropName) => {
			const moduleProp = module.instance[modulePropName];
			if (typeof moduleProp === "function") instance[modulePropName] = moduleProp.bind(instance);
			else instance[modulePropName] = moduleProp;
		});
		if (module.on && instance.on) Object.keys(module.on).forEach((moduleEventName) => {
			instance.on(moduleEventName, module.on[moduleEventName]);
		});
		if (module.vnode) {
			if (!instance.vnodeHooks) instance.vnodeHooks = {};
			Object.keys(module.vnode).forEach((vnodeId) => {
				Object.keys(module.vnode[vnodeId]).forEach((hookName) => {
					const handler = module.vnode[vnodeId][hookName];
					if (!instance.vnodeHooks[hookName]) instance.vnodeHooks[hookName] = {};
					if (!instance.vnodeHooks[hookName][vnodeId]) instance.vnodeHooks[hookName][vnodeId] = [];
					instance.vnodeHooks[hookName][vnodeId].push(handler.bind(instance));
				});
			});
		}
		if (module.create) module.create.bind(instance)(moduleParams);
	}
	useModules(modulesParams = {}) {
		const instance = this;
		if (!instance.modules) return;
		Object.keys(instance.modules).forEach((moduleName) => {
			const moduleParams = modulesParams[moduleName] || {};
			instance.useModule(moduleName, moduleParams);
		});
	}
	static set components(components) {
		const Class = this;
		if (!Class.use) return;
		Class.use(components);
	}
	static installModule(module, ...params) {
		const Class = this;
		if (!Class.prototype.modules) Class.prototype.modules = {};
		const name = module.name || `${Object.keys(Class.prototype.modules).length}_${now$1()}`;
		Class.prototype.modules[name] = module;
		if (module.proto) Object.keys(module.proto).forEach((key) => {
			Class.prototype[key] = module.proto[key];
		});
		if (module.static) Object.keys(module.static).forEach((key) => {
			Class[key] = module.static[key];
		});
		if (module.install) module.install.apply(Class, params);
		return Class;
	}
	static use(module, ...params) {
		const Class = this;
		if (Array.isArray(module)) {
			module.forEach((m) => Class.installModule(m));
			return Class;
		}
		return Class.installModule(module, ...params);
	}
};
function ConstructorMethods(parameters = {}) {
	const { defaultSelector, constructor: Constructor, domProp, app, addMethods } = parameters;
	const methods = {
		create(...args) {
			if (app) return new Constructor(app, ...args);
			return new Constructor(...args);
		},
		get(el = defaultSelector) {
			if (el instanceof Constructor) return el;
			const $el = dom7_default(el);
			if ($el.length === 0) return void 0;
			return $el[0][domProp];
		},
		destroy(el) {
			const instance = methods.get(el);
			if (instance && instance.destroy) return instance.destroy();
		}
	};
	if (addMethods && Array.isArray(addMethods)) addMethods.forEach((methodName) => {
		methods[methodName] = (el = defaultSelector, ...args) => {
			const instance = methods.get(el);
			if (instance && instance[methodName]) return instance[methodName](...args);
		};
	});
	return methods;
}
function ModalMethods(parameters = {}) {
	const { defaultSelector, constructor: Constructor, app } = parameters;
	return extend$1(ConstructorMethods({
		defaultSelector,
		constructor: Constructor,
		app,
		domProp: "f7Modal"
	}), {
		open(el, animate, targetEl) {
			let $el = dom7_default(el);
			if ($el.length > 1 && targetEl) {
				const $targetPage = dom7_default(targetEl).parents(".page");
				if ($targetPage.length) $el.each((modalEl) => {
					const $modalEl = dom7_default(modalEl);
					if ($modalEl.parents($targetPage)[0] === $targetPage[0]) $el = $modalEl;
				});
			}
			if ($el.length > 1) $el = $el.eq($el.length - 1);
			if (!$el.length) return void 0;
			let instance = $el[0].f7Modal;
			if (!instance) {
				const params = $el.dataset();
				instance = new Constructor(app, {
					el: $el,
					...params
				});
			}
			return instance.open(animate);
		},
		close(el = defaultSelector, animate, targetEl) {
			let $el = dom7_default(el);
			if (!$el.length) return void 0;
			if ($el.length > 1) {
				let $parentEl;
				if (targetEl) {
					const $targetEl = dom7_default(targetEl);
					if ($targetEl.length) $parentEl = $targetEl.parents($el);
				}
				if ($parentEl && $parentEl.length > 0) $el = $parentEl;
				else $el = $el.eq($el.length - 1);
			}
			let instance = $el[0].f7Modal;
			if (!instance) {
				const params = $el.dataset();
				instance = new Constructor(app, {
					el: $el,
					...params
				});
			}
			return instance.close(animate);
		}
	});
}
var fetchedModules = [];
function loadModule(moduleToLoad) {
	const Framework7 = this;
	const window = getWindow();
	const document = getDocument();
	return new Promise((resolve, reject) => {
		const app = Framework7.instance;
		let modulePath;
		let moduleObj;
		let moduleFunc;
		if (!moduleToLoad) {
			reject(/* @__PURE__ */ new Error("Framework7: Lazy module must be specified"));
			return;
		}
		function install(module) {
			Framework7.use(module);
			if (app) {
				app.useModuleParams(module, app.params);
				app.useModule(module);
			}
		}
		if (typeof moduleToLoad === "string") {
			const matchNamePattern = moduleToLoad.match(/([a-z0-9-]*)/i);
			if (moduleToLoad.indexOf(".") < 0 && matchNamePattern && matchNamePattern[0].length === moduleToLoad.length) {
				if (!app || app && !app.params.lazyModulesPath) {
					reject(/* @__PURE__ */ new Error("Framework7: \"lazyModulesPath\" app parameter must be specified to fetch module by name"));
					return;
				}
				modulePath = `${app.params.lazyModulesPath}/${moduleToLoad}/${moduleToLoad}.lazy.js`;
			} else modulePath = moduleToLoad;
		} else if (typeof moduleToLoad === "function") moduleFunc = moduleToLoad;
		else moduleObj = moduleToLoad;
		if (moduleFunc) {
			const module = moduleFunc(Framework7, false);
			if (!module) {
				reject(/* @__PURE__ */ new Error("Framework7: Can't find Framework7 component in specified component function"));
				return;
			}
			if (Framework7.prototype.modules && Framework7.prototype.modules[module.name]) {
				resolve();
				return;
			}
			install(module);
			resolve();
		}
		if (moduleObj) {
			const module = moduleObj;
			if (!module) {
				reject(/* @__PURE__ */ new Error("Framework7: Can't find Framework7 component in specified component"));
				return;
			}
			if (Framework7.prototype.modules && Framework7.prototype.modules[module.name]) {
				resolve();
				return;
			}
			install(module);
			resolve();
		}
		if (modulePath) {
			if (fetchedModules.indexOf(modulePath) >= 0) {
				resolve();
				return;
			}
			fetchedModules.push(modulePath);
			const scriptLoad = new Promise((resolveScript, rejectScript) => {
				fetch(modulePath).then((res) => res.text()).then((scriptContent) => {
					const callbackLoadName = `f7_component_loader_callback_${id()}`;
					const scriptEl = document.createElement("script");
					scriptEl.innerHTML = `window.${callbackLoadName} = function (Framework7, Framework7AutoInstallComponent) {return ${scriptContent.trim()}}`;
					dom7_default("head").append(scriptEl);
					const componentLoader = window[callbackLoadName];
					delete window[callbackLoadName];
					dom7_default(scriptEl).remove();
					const module = componentLoader(Framework7, false);
					if (!module) {
						rejectScript(/* @__PURE__ */ new Error(`Framework7: Can't find Framework7 component in ${modulePath} file`));
						return;
					}
					if (Framework7.prototype.modules && Framework7.prototype.modules[module.name]) {
						resolveScript();
						return;
					}
					install(module);
					resolveScript();
				}).catch((err) => {
					rejectScript(err);
				});
			});
			const styleLoad = new Promise((resolveStyle) => {
				fetch(modulePath.replace(".lazy.js", app.rtl ? ".rtl.css" : ".css").replace(".js", app.rtl ? ".rtl.css" : ".css")).then((res) => res.text()).then((styleContent) => {
					const styleEl = document.createElement("style");
					styleEl.innerHTML = styleContent;
					dom7_default("head").append(styleEl);
					resolveStyle();
				}).catch(() => {
					resolveStyle();
				});
			});
			Promise.all([scriptLoad, styleLoad]).then(() => {
				resolve();
			}).catch((err) => {
				reject(err);
			});
		}
	});
}
var $jsx$1 = (tag, props, ...args) => {
	const attrs = props || {};
	const children = args || [];
	const attrsString = Object.keys(attrs).map((attr) => {
		if (attr[0] === "_") {
			if (attrs[attr]) return attr.replace("_", "");
			return "";
		}
		return `${attr}="${attrs[attr]}"`;
	}).filter((attr) => !!attr).join(" ");
	if ([
		"path",
		"img",
		"circle",
		"polygon",
		"line",
		"input"
	].indexOf(tag) >= 0) return `<${tag} ${attrsString} />`.trim();
	return `<${tag} ${attrsString}>${children.filter((c) => !!c).map((c) => Array.isArray(c) ? c.join("") : c).join("")}</${tag}>`.trim();
};
var Framework7 = class Framework7 extends Framework7Class {
	constructor(params = {}) {
		super(params);
		if (Framework7.instance && typeof window !== "undefined") throw new Error("Framework7 is already initialized and can't be initialized more than once");
		const device = getDevice({ userAgent: params.userAgent || void 0 });
		const support = getSupport();
		const passedParams = extend$1({}, params);
		const app = this;
		app.device = device;
		app.support = support;
		const w = getWindow();
		const d = getDocument();
		Framework7.instance = app;
		const defaults = {
			el: "body",
			theme: "auto",
			routes: [],
			name: "Framework7",
			lazyModulesPath: null,
			initOnDeviceReady: true,
			init: true,
			darkMode: void 0,
			iosTranslucentBars: true,
			iosTranslucentModals: true,
			component: void 0,
			componentUrl: void 0,
			userAgent: null,
			url: null,
			mdColorScheme: "default",
			colors: {
				primary: "#007aff",
				red: "#ff3b30",
				green: "#4cd964",
				blue: "#2196f3",
				pink: "#ff2d55",
				yellow: "#ffcc00",
				orange: "#ff9500",
				purple: "#9c27b0",
				deeppurple: "#673ab7",
				lightblue: "#5ac8fa",
				teal: "#009688",
				lime: "#cddc39",
				deeporange: "#ff6b22",
				white: "#ffffff",
				black: "#000000"
			}
		};
		app.useModulesParams(defaults);
		app.params = extend$1(defaults, params);
		extend$1(app, {
			name: app.params.name,
			routes: app.params.routes,
			theme: function getTheme() {
				if (app.params.theme === "auto") {
					if (device.ios) return "ios";
					return "md";
				}
				return app.params.theme;
			}(),
			passedParams,
			online: w.navigator.onLine,
			colors: app.params.colors,
			mdColorScheme: app.params.mdColorScheme || "default",
			darkMode: app.params.darkMode
		});
		if (params.store) app.params.store = params.store;
		if (app.$el && app.$el[0]) app.$el[0].f7 = app;
		app.useModules();
		app.initStore();
		if (app.params.init) {
			if (device.cordova && app.params.initOnDeviceReady) dom7_default(d).on("deviceready", () => {
				app.init();
			});
			else app.init();
		}
		return app;
	}
	setColorTheme(color, mdColorScheme) {
		if (!color) return;
		const app = this;
		app.colors.primary = color;
		app.mdColorScheme = mdColorScheme || app.mdColorScheme;
		app.setColors();
	}
	setMdColorScheme(mdColorScheme) {
		const app = this;
		app.mdColorScheme = mdColorScheme || app.mdColorScheme;
		app.setColors();
	}
	setColors() {
		const app = this;
		const document = getDocument();
		if (!app.colorsStyleEl) {
			app.colorsStyleEl = document.createElement("style");
			document.head.prepend(app.colorsStyleEl);
		}
		app.colorsStyleEl.textContent = app.utils.colorThemeCSSStyles(app.colors, app.mdColorScheme);
	}
	mount(rootEl) {
		const app = this;
		const window = getWindow();
		const document = getDocument();
		const $rootEl = dom7_default(rootEl || app.params.el).eq(0);
		app.$el = $rootEl;
		if (app.$el && app.$el[0]) {
			app.el = app.$el[0];
			app.el.f7 = app;
			app.rtl = $rootEl.css("direction") === "rtl";
		}
		const DARK = "(prefers-color-scheme: dark)";
		const LIGHT = "(prefers-color-scheme: light)";
		app.mq = {};
		if (window.matchMedia) {
			app.mq.dark = window.matchMedia(DARK);
			app.mq.light = window.matchMedia(LIGHT);
		}
		app.colorSchemeListener = function colorSchemeListener({ matches, media }) {
			if (!matches) return;
			const html = document.querySelector("html");
			if (media === DARK) {
				html.classList.add("dark");
				app.darkMode = true;
				app.emit("darkModeChange", true);
			} else if (media === LIGHT) {
				html.classList.remove("dark");
				app.darkMode = false;
				app.emit("darkModeChange", false);
			}
		};
		app.emit("mount");
	}
	initStore() {
		const app = this;
		if (typeof app.params.store !== "undefined" && app.params.store.__store) app.store = app.params.store;
		else app.store = app.createStore(app.params.store);
	}
	enableAutoDarkMode() {
		const window = getWindow();
		const document = getDocument();
		if (!window.matchMedia) return;
		const app = this;
		const html = document.querySelector("html");
		if (app.mq.dark && app.mq.light) {
			app.mq.dark.addEventListener("change", app.colorSchemeListener);
			app.mq.light.addEventListener("change", app.colorSchemeListener);
		}
		if (app.mq.dark && app.mq.dark.matches) {
			html.classList.add("dark");
			app.darkMode = true;
			app.emit("darkModeChange", true);
		} else if (app.mq.light && app.mq.light.matches) {
			html.classList.remove("dark");
			app.darkMode = false;
			app.emit("darkModeChange", false);
		}
	}
	disableAutoDarkMode() {
		if (!getWindow().matchMedia) return;
		const app = this;
		if (app.mq.dark) app.mq.dark.removeEventListener("change", app.colorSchemeListener);
		if (app.mq.light) app.mq.light.removeEventListener("change", app.colorSchemeListener);
	}
	setDarkMode(mode) {
		const app = this;
		if (mode === "auto") app.enableAutoDarkMode();
		else {
			app.disableAutoDarkMode();
			dom7_default("html")[mode ? "addClass" : "removeClass"]("dark");
			app.darkMode = mode;
		}
	}
	initAppComponent(callback) {
		const app = this;
		app.router.componentLoader(app.params.component, app.params.componentUrl, { componentOptions: { el: app.$el[0] } }, (el) => {
			app.$el = dom7_default(el);
			app.$el[0].f7 = app;
			app.$elComponent = el.f7Component;
			app.el = app.$el[0];
			if (callback) callback();
		}, () => {});
	}
	init(rootEl) {
		const app = this;
		app.setColors();
		app.mount(rootEl);
		const init = () => {
			if (app.initialized) return;
			app.$el.addClass("framework7-initializing");
			if (app.rtl) dom7_default("html").attr("dir", "rtl");
			if (typeof app.params.darkMode === "undefined") app.darkMode = dom7_default("html").hasClass("dark");
			else app.setDarkMode(app.params.darkMode);
			const window = getWindow();
			window.addEventListener("offline", () => {
				app.online = false;
				app.emit("offline");
				app.emit("connection", false);
			});
			window.addEventListener("online", () => {
				app.online = true;
				app.emit("online");
				app.emit("connection", true);
			});
			app.$el.addClass("framework7-root");
			dom7_default("html").removeClass("ios md").addClass(app.theme);
			if (app.params.iosTranslucentBars && app.theme === "ios") dom7_default("html").addClass("ios-translucent-bars");
			if (app.params.iosTranslucentModals && app.theme === "ios") dom7_default("html").addClass("ios-translucent-modals");
			nextFrame$1(() => {
				app.$el.removeClass("framework7-initializing");
			});
			app.initialized = true;
			app.emit("init");
		};
		if (app.params.component || app.params.componentUrl) app.initAppComponent(() => {
			init();
		});
		else init();
		return app;
	}
	loadModule(...args) {
		return Framework7.loadModule(...args);
	}
	loadModules(...args) {
		return Framework7.loadModules(...args);
	}
	getVnodeHooks(hook, id) {
		const app = this;
		if (!app.vnodeHooks || !app.vnodeHooks[hook]) return [];
		return app.vnodeHooks[hook][id] || [];
	}
	get $() {
		return dom7_default;
	}
	static get Dom7() {
		return dom7_default;
	}
	static get $() {
		return dom7_default;
	}
	static get device() {
		return getDevice();
	}
	static get support() {
		return getSupport();
	}
	static get Class() {
		return Framework7Class;
	}
	static get Events() {
		return EventsClass;
	}
};
Framework7.$jsx = $jsx$1;
Framework7.ModalMethods = ModalMethods;
Framework7.ConstructorMethods = ConstructorMethods;
Framework7.loadModule = loadModule;
Framework7.loadModules = function loadModules(modules) {
	return Promise.all(modules.map((module) => Framework7.loadModule(module)));
};
var device_default = {
	name: "device",
	static: { getDevice },
	on: { init() {
		const document = getDocument();
		const device = getDevice();
		const classNames = [];
		const html = document.querySelector("html");
		const metaStatusbar = document.querySelector("meta[name=\"apple-mobile-web-app-status-bar-style\"]");
		if (!html) return;
		if (device.standalone && device.ios && metaStatusbar && metaStatusbar.content === "black-translucent") classNames.push("device-full-viewport");
		classNames.push(`device-pixel-ratio-${Math.floor(device.pixelRatio)}`);
		if (device.os && !device.desktop) classNames.push(`device-${device.os}`);
		else if (device.desktop) {
			classNames.push("device-desktop");
			if (device.os) classNames.push(`device-${device.os}`);
		}
		if (device.cordova) classNames.push("device-cordova");
		if (device.capacitor) classNames.push("device-capacitor");
		classNames.forEach((className) => {
			html.classList.add(className);
		});
	} }
};
var support_default = {
	name: "support",
	static: { getSupport }
};
var utils_default = {
	name: "utils",
	proto: { utils: utils_exports },
	static: { utils: utils_exports }
};
var resize_default = {
	name: "resize",
	create() {
		const app = this;
		app.getSize = () => {
			if (!app.el) return {
				width: 0,
				height: 0,
				left: 0,
				top: 0
			};
			const offset = app.$el.offset();
			const [width, height, left, top] = [
				app.el.offsetWidth,
				app.el.offsetHeight,
				offset.left,
				offset.top
			];
			app.width = width;
			app.height = height;
			app.left = left;
			app.top = top;
			return {
				width,
				height,
				left,
				top
			};
		};
	},
	on: {
		init() {
			const app = this;
			const window = getWindow();
			app.getSize();
			window.addEventListener("resize", () => {
				app.emit("resize");
			}, false);
			window.addEventListener("orientationchange", () => {
				app.emit("orientationchange");
			});
		},
		orientationchange() {
			const document = getDocument();
			if (getDevice().ipad) {
				document.body.scrollLeft = 0;
				setTimeout(() => {
					document.body.scrollLeft = 0;
				}, 0);
			}
		},
		resize() {
			this.getSize();
		}
	}
};
function initTouch() {
	const app = this;
	const device = getDevice();
	const support = getSupport();
	const window = getWindow();
	const document = getDocument();
	const params = app.params.touch;
	const useRipple = params.touchRipple && app.theme === "md";
	if (device.ios && device.webView) window.addEventListener("touchstart", () => {});
	let touchStartX;
	let touchStartY;
	let targetElement;
	let isMoved;
	let tapHoldFired;
	let tapHoldTimeout;
	let preventClick;
	let activableElement;
	let activeTimeout;
	let rippleWave;
	let rippleTarget;
	let rippleTimeout;
	function findActivableElement(el) {
		const target = dom7_default(el);
		const parents = target.parents(params.activeStateElements);
		if (target.closest(".no-active-state").length) return null;
		let activable;
		if (target.is(params.activeStateElements)) activable = target;
		if (parents.length > 0) activable = activable ? activable.add(parents) : parents;
		if (activable && activable.length > 1) {
			const newActivable = [];
			let preventPropagation;
			for (let i = 0; i < activable.length; i += 1) if (!preventPropagation) {
				newActivable.push(activable[i]);
				if (activable.eq(i).hasClass("prevent-active-state-propagation") || activable.eq(i).hasClass("no-active-state-propagation")) preventPropagation = true;
			}
			activable = dom7_default(newActivable);
		}
		return activable || target;
	}
	function isInsideScrollableView(el) {
		return el.parents(".page-content").length > 0;
	}
	function addActive() {
		if (!activableElement) return;
		activableElement.addClass("active-state");
	}
	function removeActive() {
		if (!activableElement) return;
		activableElement.removeClass("active-state");
		activableElement = null;
	}
	function findRippleElement(el) {
		const rippleElements = params.touchRippleElements;
		const $el = dom7_default(el);
		if ($el.is(rippleElements)) {
			if ($el.hasClass("no-ripple")) return false;
			return $el;
		}
		if ($el.parents(rippleElements).length > 0) {
			const rippleParent = $el.parents(rippleElements).eq(0);
			if (rippleParent.hasClass("no-ripple")) return false;
			return rippleParent;
		}
		return false;
	}
	function createRipple($el, x, y) {
		if (!$el) return;
		rippleWave = app.touchRipple.create(app, $el, x, y);
	}
	function removeRipple() {
		if (!rippleWave) return;
		rippleWave.remove();
		rippleWave = void 0;
		rippleTarget = void 0;
	}
	function rippleTouchStart(el) {
		rippleTarget = findRippleElement(el);
		if (!rippleTarget || rippleTarget.length === 0) {
			rippleTarget = void 0;
			return;
		}
		if (!isInsideScrollableView(rippleTarget)) {
			removeRipple();
			createRipple(rippleTarget, touchStartX, touchStartY);
		} else {
			clearTimeout(rippleTimeout);
			rippleTimeout = setTimeout(() => {
				removeRipple();
				createRipple(rippleTarget, touchStartX, touchStartY);
			}, 80);
		}
	}
	function rippleTouchMove() {
		clearTimeout(rippleTimeout);
		removeRipple();
	}
	function rippleTouchEnd() {
		if (!rippleWave && rippleTarget && !isMoved) {
			clearTimeout(rippleTimeout);
			createRipple(rippleTarget, touchStartX, touchStartY);
			setTimeout(removeRipple, 0);
		} else removeRipple();
	}
	function handleMouseDown(e) {
		const $activableEl = findActivableElement(e.target);
		if ($activableEl) {
			$activableEl.addClass("active-state");
			if ("which" in e && e.which === 3) setTimeout(() => {
				dom7_default(".active-state").removeClass("active-state");
			}, 0);
		}
		if (useRipple) {
			touchStartX = e.pageX;
			touchStartY = e.pageY;
			rippleTouchStart(e.target, e.pageX, e.pageY);
		}
	}
	function handleMouseMove() {
		if (!params.activeStateOnMouseMove) dom7_default(".active-state").removeClass("active-state");
		if (useRipple) rippleTouchMove();
	}
	function handleMouseUp() {
		dom7_default(".active-state").removeClass("active-state");
		if (useRipple) rippleTouchEnd();
	}
	function handleTouchCancel() {
		targetElement = null;
		clearTimeout(activeTimeout);
		clearTimeout(tapHoldTimeout);
		if (params.activeState) removeActive();
		if (useRipple) rippleTouchEnd();
	}
	let isScrolling;
	let isSegmentedStrong = false;
	let segmentedStrongEl = null;
	const touchMoveActivableIos = ".dialog-button, .actions-button";
	let isTouchMoveActivable = false;
	let touchmoveActivableEl = null;
	function handleTouchStart(e) {
		if (!e.isTrusted) return true;
		isMoved = false;
		tapHoldFired = false;
		preventClick = false;
		isScrolling = void 0;
		if (e.targetTouches.length > 1) {
			if (activableElement) removeActive();
			return true;
		}
		if (e.touches.length > 1 && activableElement) removeActive();
		if (params.tapHold) {
			if (tapHoldTimeout) clearTimeout(tapHoldTimeout);
			tapHoldTimeout = setTimeout(() => {
				if (e && e.touches && e.touches.length > 1) return;
				tapHoldFired = true;
				e.preventDefault();
				preventClick = true;
				dom7_default(e.target).trigger("taphold", e);
				app.emit("taphold", e);
			}, params.tapHoldDelay);
		}
		targetElement = e.target;
		touchStartX = e.targetTouches[0].pageX;
		touchStartY = e.targetTouches[0].pageY;
		isSegmentedStrong = e.target.closest(".segmented-strong .button-active, .segmented-strong .tab-link-active");
		isTouchMoveActivable = app.theme === "ios" && e.target.closest(touchMoveActivableIos);
		if (isSegmentedStrong) segmentedStrongEl = isSegmentedStrong.closest(".segmented-strong");
		if (params.activeState) {
			activableElement = findActivableElement(targetElement);
			if (activableElement && !isInsideScrollableView(activableElement)) addActive();
			else if (activableElement) activeTimeout = setTimeout(addActive, 80);
		}
		if (useRipple) rippleTouchStart(targetElement, touchStartX, touchStartY);
		return true;
	}
	function handleTouchMove(e) {
		if (!e.isTrusted) return;
		let touch;
		let distance;
		let shouldRemoveActive = true;
		if (e.type === "touchmove") {
			touch = e.targetTouches[0];
			distance = params.touchClicksDistanceThreshold;
		}
		const touchCurrentX = e.targetTouches[0].pageX;
		const touchCurrentY = e.targetTouches[0].pageY;
		if (typeof isScrolling === "undefined") isScrolling = !!(isScrolling || Math.abs(touchCurrentY - touchStartY) > Math.abs(touchCurrentX - touchStartX));
		if (isTouchMoveActivable || !isScrolling && isSegmentedStrong && segmentedStrongEl) {
			if (e.cancelable) e.preventDefault();
		}
		if (!isScrolling && isSegmentedStrong && segmentedStrongEl) {
			const buttonEl = document.elementFromPoint(e.targetTouches[0].clientX, e.targetTouches[0].clientY).closest(".segmented-strong .button:not(.button-active):not(.tab-link-active)");
			if (buttonEl && segmentedStrongEl.contains(buttonEl)) {
				dom7_default(buttonEl).trigger("click", "f7Segmented");
				targetElement = buttonEl;
			}
		}
		if (distance && touch) {
			const pageX = touch.pageX;
			const pageY = touch.pageY;
			if (Math.abs(pageX - touchStartX) > distance || Math.abs(pageY - touchStartY) > distance) isMoved = true;
		} else isMoved = true;
		if (isMoved) {
			preventClick = true;
			if (isTouchMoveActivable) {
				touchmoveActivableEl = document.elementFromPoint(e.targetTouches[0].clientX, e.targetTouches[0].clientY).closest(touchMoveActivableIos);
				if (touchmoveActivableEl && activableElement && activableElement[0] === touchmoveActivableEl) shouldRemoveActive = false;
				else if (touchmoveActivableEl) setTimeout(() => {
					activableElement = findActivableElement(touchmoveActivableEl);
					addActive();
				});
			}
			if (params.tapHold) clearTimeout(tapHoldTimeout);
			if (params.activeState && shouldRemoveActive) {
				clearTimeout(activeTimeout);
				removeActive();
			}
			if (useRipple) rippleTouchMove();
		}
	}
	function handleTouchEnd(e) {
		if (!e.isTrusted) return true;
		isScrolling = void 0;
		isSegmentedStrong = false;
		segmentedStrongEl = null;
		isTouchMoveActivable = false;
		clearTimeout(activeTimeout);
		clearTimeout(tapHoldTimeout);
		if (touchmoveActivableEl) {
			dom7_default(touchmoveActivableEl).trigger("click", "f7TouchMoveActivable");
			touchmoveActivableEl = null;
		}
		if (document.activeElement === e.target) {
			if (params.activeState) removeActive();
			if (useRipple) rippleTouchEnd();
			return true;
		}
		if (params.activeState) {
			addActive();
			setTimeout(removeActive, 0);
		}
		if (useRipple) rippleTouchEnd();
		if (params.tapHoldPreventClicks && tapHoldFired || preventClick) {
			if (e.cancelable) e.preventDefault();
			preventClick = true;
			return false;
		}
		return true;
	}
	function handleClick(e) {
		const isOverswipe = e && e.detail && e.detail === "f7Overswipe";
		const isSegmented = e && e.detail && e.detail === "f7Segmented";
		const isTouchMoveActivable = e && e.detail && e.detail === "f7TouchMoveActivable";
		let localPreventClick = preventClick;
		if (targetElement && e.target !== targetElement) {
			if (isOverswipe || isSegmented || isTouchMoveActivable) localPreventClick = false;
			else localPreventClick = true;
		} else if (isTouchMoveActivable) localPreventClick = false;
		if (params.tapHold && params.tapHoldPreventClicks && tapHoldFired) localPreventClick = true;
		if (localPreventClick) {
			e.stopImmediatePropagation();
			e.stopPropagation();
			e.preventDefault();
		}
		if (params.tapHold) tapHoldTimeout = setTimeout(() => {
			tapHoldFired = false;
		}, device.ios || device.androidChrome ? 100 : 400);
		preventClick = false;
		targetElement = null;
		return !localPreventClick;
	}
	function emitAppTouchEvent(name, e) {
		app.emit({
			events: name,
			data: [e]
		});
	}
	function appClick(e) {
		emitAppTouchEvent("click", e);
	}
	function appTouchStartActive(e) {
		emitAppTouchEvent("touchstart touchstart:active", e);
	}
	function appTouchMoveActive(e) {
		emitAppTouchEvent("touchmove touchmove:active", e);
	}
	function appTouchEndActive(e) {
		emitAppTouchEvent("touchend touchend:active", e);
	}
	function appTouchStartPassive(e) {
		emitAppTouchEvent("touchstart:passive", e);
	}
	function appTouchMovePassive(e) {
		emitAppTouchEvent("touchmove:passive", e);
	}
	function appTouchEndPassive(e) {
		emitAppTouchEvent("touchend:passive", e);
	}
	const passiveListener = { passive: true };
	const passiveListenerCapture = {
		passive: true,
		capture: true
	};
	const activeListener = { passive: false };
	const activeListenerCapture = {
		passive: false,
		capture: true
	};
	document.addEventListener("click", appClick, true);
	document.addEventListener(app.touchEvents.start, appTouchStartActive, activeListenerCapture);
	document.addEventListener(app.touchEvents.move, appTouchMoveActive, activeListener);
	document.addEventListener(app.touchEvents.end, appTouchEndActive, activeListener);
	document.addEventListener(app.touchEvents.start, appTouchStartPassive, passiveListenerCapture);
	document.addEventListener(app.touchEvents.move, appTouchMovePassive, passiveListener);
	document.addEventListener(app.touchEvents.end, appTouchEndPassive, passiveListener);
	if (support.touch) {
		app.on("click", handleClick);
		app.on("touchstart", handleTouchStart);
		app.on("touchmove", handleTouchMove);
		app.on("touchend", handleTouchEnd);
		document.addEventListener("touchcancel", handleTouchCancel, { passive: true });
	} else if (params.activeState) {
		app.on("touchstart", handleMouseDown);
		app.on("touchmove", handleMouseMove);
		app.on("touchend", handleMouseUp);
		document.addEventListener("pointercancel", handleMouseUp, { passive: true });
	}
	document.addEventListener("contextmenu", (e) => {
		if (params.disableContextMenu && (device.ios || device.android || device.cordova || window.Capacitor && (window.Capacitor.isNative || window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()))) e.preventDefault();
		if (useRipple) {
			if (activableElement) removeActive();
			rippleTouchEnd();
		}
	});
}
var touch_default = {
	name: "touch",
	params: { touch: {
		touchClicksDistanceThreshold: 5,
		disableContextMenu: false,
		tapHold: false,
		tapHoldDelay: 750,
		tapHoldPreventClicks: true,
		activeState: true,
		activeStateElements: "a, button, label, span, .actions-button, .stepper-button, .stepper-button-plus, .stepper-button-minus, .card-expandable, .link, .item-link, .accordion-item-toggle",
		activeStateOnMouseMove: false,
		touchRipple: true,
		touchRippleElements: ".ripple, .link, .item-link, .list label.item-content, .list-button, .links-list a, .button, button, .input-clear-button, .dialog-button, .tab-link, .item-radio, .item-checkbox, .actions-button, .searchbar-disable-button, .fab a, .checkbox, .radio, .data-table .sortable-cell:not(.input-cell), .notification-close-button, .stepper-button, .stepper-button-minus, .stepper-button-plus, .list.accordion-list .accordion-item-toggle",
		touchRippleInsetElements: ".ripple-inset, .icon-only, .searchbar-disable-button, .input-clear-button, .notification-close-button, .md .navbar .link.back",
		touchHighlight: true,
		touchHighlightElements: ".toolbar-pane, .navbar .left, .navbar .right, .actions-group:not(.actions-grid .actions-group), .searchbar-input-wrap, .searchbar-disable-button, .subnavbar, .searchbar-input-wrap .autocomplete-dropdown, .messagebar-area, .notification, .toast, .fab > a"
	} },
	create() {
		const app = this;
		const support = getSupport();
		extend$1(app, { touchEvents: {
			start: support.touch ? "touchstart" : "pointerdown",
			move: support.touch ? "touchmove" : "pointermove",
			end: support.touch ? "touchend" : "pointerup"
		} });
	},
	on: { init: initTouch }
};
/**
* Tokenize input string.
*/
function lexer(str) {
	var tokens = [];
	var i = 0;
	while (i < str.length) {
		var char = str[i];
		if (char === "*" || char === "+" || char === "?") {
			tokens.push({
				type: "MODIFIER",
				index: i,
				value: str[i++]
			});
			continue;
		}
		if (char === "\\") {
			tokens.push({
				type: "ESCAPED_CHAR",
				index: i++,
				value: str[i++]
			});
			continue;
		}
		if (char === "{") {
			tokens.push({
				type: "OPEN",
				index: i,
				value: str[i++]
			});
			continue;
		}
		if (char === "}") {
			tokens.push({
				type: "CLOSE",
				index: i,
				value: str[i++]
			});
			continue;
		}
		if (char === ":") {
			var name = "";
			var j = i + 1;
			while (j < str.length) {
				var code = str.charCodeAt(j);
				if (code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95) {
					name += str[j++];
					continue;
				}
				break;
			}
			if (!name) throw new TypeError("Missing parameter name at ".concat(i));
			tokens.push({
				type: "NAME",
				index: i,
				value: name
			});
			i = j;
			continue;
		}
		if (char === "(") {
			var count = 1;
			var pattern = "";
			var j = i + 1;
			if (str[j] === "?") throw new TypeError("Pattern cannot start with \"?\" at ".concat(j));
			while (j < str.length) {
				if (str[j] === "\\") {
					pattern += str[j++] + str[j++];
					continue;
				}
				if (str[j] === ")") {
					count--;
					if (count === 0) {
						j++;
						break;
					}
				} else if (str[j] === "(") {
					count++;
					if (str[j + 1] !== "?") throw new TypeError("Capturing groups are not allowed at ".concat(j));
				}
				pattern += str[j++];
			}
			if (count) throw new TypeError("Unbalanced pattern at ".concat(i));
			if (!pattern) throw new TypeError("Missing pattern at ".concat(i));
			tokens.push({
				type: "PATTERN",
				index: i,
				value: pattern
			});
			i = j;
			continue;
		}
		tokens.push({
			type: "CHAR",
			index: i,
			value: str[i++]
		});
	}
	tokens.push({
		type: "END",
		index: i,
		value: ""
	});
	return tokens;
}
/**
* Parse a string for the raw tokens.
*/
function parse(str, options) {
	if (options === void 0) options = {};
	var tokens = lexer(str);
	var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
	var result = [];
	var key = 0;
	var i = 0;
	var path = "";
	var tryConsume = function(type) {
		if (i < tokens.length && tokens[i].type === type) return tokens[i++].value;
	};
	var mustConsume = function(type) {
		var value = tryConsume(type);
		if (value !== void 0) return value;
		var _a = tokens[i], nextType = _a.type, index = _a.index;
		throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
	};
	var consumeText = function() {
		var result = "";
		var value;
		while (value = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) result += value;
		return result;
	};
	var isSafe = function(value) {
		for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
			var char = delimiter_1[_i];
			if (value.indexOf(char) > -1) return true;
		}
		return false;
	};
	var safePattern = function(prefix) {
		var prev = result[result.length - 1];
		var prevText = prefix || (prev && typeof prev === "string" ? prev : "");
		if (prev && !prevText) throw new TypeError("Must have text between two parameters, missing text after \"".concat(prev.name, "\""));
		if (!prevText || isSafe(prevText)) return "[^".concat(escapeString(delimiter), "]+?");
		return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
	};
	while (i < tokens.length) {
		var char = tryConsume("CHAR");
		var name = tryConsume("NAME");
		var pattern = tryConsume("PATTERN");
		if (name || pattern) {
			var prefix = char || "";
			if (prefixes.indexOf(prefix) === -1) {
				path += prefix;
				prefix = "";
			}
			if (path) {
				result.push(path);
				path = "";
			}
			result.push({
				name: name || key++,
				prefix,
				suffix: "",
				pattern: pattern || safePattern(prefix),
				modifier: tryConsume("MODIFIER") || ""
			});
			continue;
		}
		var value = char || tryConsume("ESCAPED_CHAR");
		if (value) {
			path += value;
			continue;
		}
		if (path) {
			result.push(path);
			path = "";
		}
		if (tryConsume("OPEN")) {
			var prefix = consumeText();
			var name_1 = tryConsume("NAME") || "";
			var pattern_1 = tryConsume("PATTERN") || "";
			var suffix = consumeText();
			mustConsume("CLOSE");
			result.push({
				name: name_1 || (pattern_1 ? key++ : ""),
				pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
				prefix,
				suffix,
				modifier: tryConsume("MODIFIER") || ""
			});
			continue;
		}
		mustConsume("END");
	}
	return result;
}
/**
* Compile a string to a template function for the path.
*/
function compile(str, options) {
	return tokensToFunction(parse(str, options), options);
}
/**
* Expose a method for transforming tokens into the path function.
*/
function tokensToFunction(tokens, options) {
	if (options === void 0) options = {};
	var reFlags = flags(options);
	var _a = options.encode, encode = _a === void 0 ? function(x) {
		return x;
	} : _a, _b = options.validate, validate = _b === void 0 ? true : _b;
	var matches = tokens.map(function(token) {
		if (typeof token === "object") return new RegExp("^(?:".concat(token.pattern, ")$"), reFlags);
	});
	return function(data) {
		var path = "";
		for (var i = 0; i < tokens.length; i++) {
			var token = tokens[i];
			if (typeof token === "string") {
				path += token;
				continue;
			}
			var value = data ? data[token.name] : void 0;
			var optional = token.modifier === "?" || token.modifier === "*";
			var repeat = token.modifier === "*" || token.modifier === "+";
			if (Array.isArray(value)) {
				if (!repeat) throw new TypeError("Expected \"".concat(token.name, "\" to not repeat, but got an array"));
				if (value.length === 0) {
					if (optional) continue;
					throw new TypeError("Expected \"".concat(token.name, "\" to not be empty"));
				}
				for (var j = 0; j < value.length; j++) {
					var segment = encode(value[j], token);
					if (validate && !matches[i].test(segment)) throw new TypeError("Expected all \"".concat(token.name, "\" to match \"").concat(token.pattern, "\", but got \"").concat(segment, "\""));
					path += token.prefix + segment + token.suffix;
				}
				continue;
			}
			if (typeof value === "string" || typeof value === "number") {
				var segment = encode(String(value), token);
				if (validate && !matches[i].test(segment)) throw new TypeError("Expected \"".concat(token.name, "\" to match \"").concat(token.pattern, "\", but got \"").concat(segment, "\""));
				path += token.prefix + segment + token.suffix;
				continue;
			}
			if (optional) continue;
			var typeOfMessage = repeat ? "an array" : "a string";
			throw new TypeError("Expected \"".concat(token.name, "\" to be ").concat(typeOfMessage));
		}
		return path;
	};
}
/**
* Escape a regular expression string.
*/
function escapeString(str) {
	return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
/**
* Get the flags for a regexp from the options.
*/
function flags(options) {
	return options && options.sensitive ? "" : "i";
}
/**
* Pull out keys from a regexp.
*/
function regexpToRegexp(path, keys) {
	if (!keys) return path;
	var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
	var index = 0;
	var execResult = groupsRegex.exec(path.source);
	while (execResult) {
		keys.push({
			name: execResult[1] || index++,
			prefix: "",
			suffix: "",
			modifier: "",
			pattern: ""
		});
		execResult = groupsRegex.exec(path.source);
	}
	return path;
}
/**
* Transform an array into a regexp.
*/
function arrayToRegexp(paths, keys, options) {
	var parts = paths.map(function(path) {
		return pathToRegexp(path, keys, options).source;
	});
	return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
/**
* Create a path regexp from string input.
*/
function stringToRegexp(path, keys, options) {
	return tokensToRegexp(parse(path, options), keys, options);
}
/**
* Expose a function for taking tokens and returning a RegExp.
*/
function tokensToRegexp(tokens, keys, options) {
	if (options === void 0) options = {};
	var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
		return x;
	} : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
	var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
	var delimiterRe = "[".concat(escapeString(delimiter), "]");
	var route = start ? "^" : "";
	for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
		var token = tokens_1[_i];
		if (typeof token === "string") route += escapeString(encode(token));
		else {
			var prefix = escapeString(encode(token.prefix));
			var suffix = escapeString(encode(token.suffix));
			if (token.pattern) {
				if (keys) keys.push(token);
				if (prefix || suffix) {
					if (token.modifier === "+" || token.modifier === "*") {
						var mod = token.modifier === "*" ? "?" : "";
						route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
					} else route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
				} else {
					if (token.modifier === "+" || token.modifier === "*") throw new TypeError("Can not repeat \"".concat(token.name, "\" without a prefix and suffix"));
					route += "(".concat(token.pattern, ")").concat(token.modifier);
				}
			} else route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
		}
	}
	if (end) {
		if (!strict) route += "".concat(delimiterRe, "?");
		route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
	} else {
		var endToken = tokens[tokens.length - 1];
		var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
		if (!strict) route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
		if (!isEndDelimited) route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
	}
	return new RegExp(route, flags(options));
}
/**
* Normalize the given path string, returning a regular expression.
*
* An empty array can be passed in for the keys, which will hold the
* placeholder key descriptions. For example, using `/user/:id`, `keys` will
* contain `[{ name: 'id', delimiter: '/', optional: false, repeat: false }]`.
*/
function pathToRegexp(path, keys, options) {
	if (path instanceof RegExp) return regexpToRegexp(path, keys);
	if (Array.isArray(path)) return arrayToRegexp(path, keys, options);
	return stringToRegexp(path, keys, options);
}
var History = {
	queue: [],
	clearQueue() {
		if (History.queue.length === 0) return;
		History.queue.shift()();
	},
	routerQueue: [],
	clearRouterQueue() {
		if (History.routerQueue.length === 0) return;
		const { router, stateUrl, action } = History.routerQueue.pop();
		let animate = router.params.animate;
		if (router.params.browserHistoryAnimate === false) animate = false;
		if (action === "back") router.back({
			animate,
			browserHistory: false
		});
		if (action === "load") router.navigate(stateUrl, {
			animate,
			browserHistory: false
		});
	},
	handle(e) {
		if (History.blockPopstate) return;
		const app = this;
		let state = e.state;
		History.previousState = History.state;
		History.state = state;
		History.allowChange = true;
		History.clearQueue();
		state = History.state;
		if (!state) state = {};
		app.views.forEach((view) => {
			const router = view.router;
			let viewState = state[view.id];
			if (!viewState && view.params.browserHistory) viewState = { url: view.router.history[0] };
			if (!viewState) return;
			const stateUrl = viewState.url || void 0;
			let animate = router.params.animate;
			if (router.params.browserHistoryAnimate === false) animate = false;
			if (stateUrl !== router.url) {
				if (router.history.indexOf(stateUrl) >= 0) {
					if (router.allowPageChange) router.back({
						animate,
						browserHistory: false
					});
					else History.routerQueue.push({
						action: "back",
						router
					});
				} else if (router.allowPageChange) router.navigate(stateUrl, {
					animate,
					browserHistory: false
				});
				else History.routerQueue.unshift({
					action: "load",
					stateUrl,
					router
				});
			}
		});
	},
	initViewState(viewId, viewState) {
		const window = getWindow();
		const newState = extend$1({}, History.state || {}, { [viewId]: viewState });
		History.state = newState;
		window.history.replaceState(newState, "");
	},
	push(viewId, viewState, url) {
		const window = getWindow();
		const document = getDocument();
		if (url.substr(-3) === "#!/") {
			url = url.replace("#!/", "");
			if (url === "") {
				url = document.location.href;
				if (url.includes("#!/")) url = document.location.href.split("#!/")[0];
			}
		}
		if (!History.allowChange) {
			History.queue.push(() => {
				History.push(viewId, viewState, url);
			});
			return;
		}
		History.previousState = History.state;
		const newState = extend$1({}, History.previousState || {}, { [viewId]: viewState });
		History.state = newState;
		window.history.pushState(newState, "", url);
	},
	replace(viewId, viewState, url) {
		const window = getWindow();
		if (url.substr(-3) === "#!/") url = url.replace("#!/", "");
		if (!History.allowChange) {
			History.queue.push(() => {
				History.replace(viewId, viewState, url);
			});
			return;
		}
		History.previousState = History.state;
		const newState = extend$1({}, History.previousState || {}, { [viewId]: viewState });
		History.state = newState;
		window.history.replaceState(newState, "", url);
	},
	go(index) {
		const window = getWindow();
		History.allowChange = false;
		window.history.go(index);
	},
	back() {
		const window = getWindow();
		History.allowChange = false;
		window.history.back();
	},
	allowChange: true,
	previousState: {},
	state: {},
	blockPopstate: true,
	init(app) {
		const window = getWindow();
		const document = getDocument();
		History.state = window.history.state;
		dom7_default(window).on("load", () => {
			setTimeout(() => {
				History.blockPopstate = false;
			}, 0);
		});
		if (document.readyState && document.readyState === "complete") History.blockPopstate = false;
		dom7_default(window).on("popstate", History.handle.bind(app));
	}
};
function SwipeBack(r) {
	const router = r;
	const { $el, app, params } = router;
	const device = getDevice();
	let isTouched = false;
	let isMoved = false;
	const touchesStart = {};
	let isScrolling;
	let $currentPageEl = [];
	let $previousPageEl = [];
	let viewContainerWidth;
	let touchesDiff;
	let allowViewTouchMove = true;
	let touchStartTime;
	let $pageShadowEl;
	let $pageOpacityEl;
	const paramsSwipeBackAnimateShadow = params[`${app.theme}SwipeBackAnimateShadow`];
	const paramsSwipeBackAnimateOpacity = params[`${app.theme}SwipeBackAnimateOpacity`];
	const paramsSwipeBackActiveArea = params[`${app.theme}SwipeBackActiveArea`];
	const paramsSwipeBackThreshold = params[`${app.theme}SwipeBackThreshold`];
	function handleTouchStart(e) {
		if (!e.isTrusted) return;
		const swipeBackEnabled = params[`${app.theme}SwipeBack`];
		if (!allowViewTouchMove || !swipeBackEnabled || isTouched || app.swipeout && app.swipeout.el || !router.allowPageChange) return;
		if (dom7_default(e.target).closest(".range-slider, .calendar-months").length > 0) return;
		if (dom7_default(e.target).closest(".page-master, .page-master-detail").length > 0 && params.masterDetailBreakpoint > 0 && app.width >= params.masterDetailBreakpoint) return;
		isMoved = false;
		isTouched = true;
		isScrolling = void 0;
		touchesStart.x = e.type === "touchstart" ? e.targetTouches[0].pageX : e.pageX;
		touchesStart.y = e.type === "touchstart" ? e.targetTouches[0].pageY : e.pageY;
		touchStartTime = now$1();
	}
	function handleTouchMove(e) {
		if (!e.isTrusted) return;
		if (!isTouched) return;
		const pageX = e.type === "touchmove" ? e.targetTouches[0].pageX : e.pageX;
		const pageY = e.type === "touchmove" ? e.targetTouches[0].pageY : e.pageY;
		if (typeof isScrolling === "undefined") isScrolling = !!(isScrolling || Math.abs(pageY - touchesStart.y) > Math.abs(pageX - touchesStart.x)) || pageX < touchesStart.x && !app.rtl || pageX > touchesStart.x && app.rtl;
		if (isScrolling || e.f7PreventSwipeBack || app.preventSwipeBack) {
			isTouched = false;
			return;
		}
		if (!isMoved) {
			let cancel = false;
			const target = dom7_default(e.target);
			const swipeout = target.closest(".swipeout");
			if (swipeout.length > 0) {
				if (!app.rtl && swipeout.find(".swipeout-actions-left").length > 0) cancel = true;
				if (app.rtl && swipeout.find(".swipeout-actions-right").length > 0) cancel = true;
			}
			$currentPageEl = target.closest(".page");
			if ($currentPageEl.hasClass("no-swipeback") || target.closest(".no-swipeback, .card-opened").length > 0) cancel = true;
			$previousPageEl = $el.find(".page-previous");
			if ($previousPageEl.length > 1) $previousPageEl = $previousPageEl.eq($previousPageEl.length - 1);
			let notFromBorder = touchesStart.x - $el.offset().left > paramsSwipeBackActiveArea;
			viewContainerWidth = $el.width();
			if (app.rtl) notFromBorder = touchesStart.x < $el.offset().left - $el[0].scrollLeft + (viewContainerWidth - paramsSwipeBackActiveArea);
			else notFromBorder = touchesStart.x - $el.offset().left > paramsSwipeBackActiveArea;
			if (notFromBorder) cancel = true;
			if ($previousPageEl.length === 0 || $currentPageEl.length === 0) cancel = true;
			if (cancel) {
				isTouched = false;
				return;
			}
			if (paramsSwipeBackAnimateShadow) {
				$pageShadowEl = $currentPageEl.find(".page-shadow-effect");
				if ($pageShadowEl.length === 0) {
					$pageShadowEl = dom7_default("<div class=\"page-shadow-effect\"></div>");
					$currentPageEl.append($pageShadowEl);
				}
			}
			if (paramsSwipeBackAnimateOpacity) {
				$pageOpacityEl = $previousPageEl.find(".page-opacity-effect");
				if ($pageOpacityEl.length === 0) {
					$pageOpacityEl = dom7_default("<div class=\"page-opacity-effect\"></div>");
					$previousPageEl.append($pageOpacityEl);
				}
			}
			if (dom7_default(".sheet.modal-in").length > 0 && app.sheet) app.sheet.close(dom7_default(".sheet.modal-in"));
		}
		e.f7PreventSwipePanel = true;
		isMoved = true;
		app.preventSwipePanelBySwipeBack = true;
		e.preventDefault();
		const inverter = app.rtl ? -1 : 1;
		touchesDiff = (pageX - touchesStart.x - paramsSwipeBackThreshold) * inverter;
		if (touchesDiff < 0) touchesDiff = 0;
		const percentage = Math.min(Math.max(touchesDiff / viewContainerWidth, 0), 1);
		const callbackData = {
			percentage,
			progress: percentage,
			currentPageEl: $currentPageEl[0],
			previousPageEl: $previousPageEl[0]
		};
		$el.trigger("swipeback:move", callbackData);
		router.emit("swipebackMove", callbackData);
		let currentPageTranslate = touchesDiff * inverter;
		let previousPageTranslate = (touchesDiff / 5 - viewContainerWidth / 5) * inverter;
		if (!app.rtl) {
			currentPageTranslate = Math.min(currentPageTranslate, viewContainerWidth);
			previousPageTranslate = Math.min(previousPageTranslate, 0);
		} else {
			currentPageTranslate = Math.max(currentPageTranslate, -viewContainerWidth);
			previousPageTranslate = Math.max(previousPageTranslate, 0);
		}
		if (device.pixelRatio === 1) {
			currentPageTranslate = Math.round(currentPageTranslate);
			previousPageTranslate = Math.round(previousPageTranslate);
		}
		router.swipeBackActive = true;
		dom7_default([$currentPageEl[0], $previousPageEl[0]]).addClass("page-swipeback-active");
		$currentPageEl.transform(`translate3d(${currentPageTranslate}px,0,0)`);
		if (paramsSwipeBackAnimateShadow) $pageShadowEl[0].style.opacity = 1 - 1 * percentage;
		$previousPageEl.transform(`translate3d(${previousPageTranslate}px,0,0)`);
		if (paramsSwipeBackAnimateOpacity) $pageOpacityEl[0].style.opacity = 1 - 1 * percentage;
	}
	function handleTouchEnd(e) {
		if (!e.isTrusted) return;
		app.preventSwipePanelBySwipeBack = false;
		if (!isTouched || !isMoved) {
			isTouched = false;
			isMoved = false;
			return;
		}
		isTouched = false;
		isMoved = false;
		router.swipeBackActive = false;
		const $pages = dom7_default([$currentPageEl[0], $previousPageEl[0]]);
		$pages.removeClass("page-swipeback-active");
		if (touchesDiff === 0) {
			$pages.transform("");
			if ($pageShadowEl && $pageShadowEl.length > 0) $pageShadowEl.remove();
			if ($pageOpacityEl && $pageOpacityEl.length > 0) $pageOpacityEl.remove();
			return;
		}
		const timeDiff = now$1() - touchStartTime;
		let pageChanged = false;
		if (timeDiff < 300 && touchesDiff > 10 || timeDiff >= 300 && touchesDiff > viewContainerWidth / 2) {
			$currentPageEl.removeClass("page-current").addClass(`page-next${app.theme !== "ios" ? " page-next-on-right" : ""}`);
			$previousPageEl.removeClass("page-previous").addClass("page-current").removeAttr("aria-hidden");
			if ($pageShadowEl) $pageShadowEl[0].style.opacity = "";
			if ($pageOpacityEl) $pageOpacityEl[0].style.opacity = "";
			pageChanged = true;
		}
		$pages.addClass("page-transitioning page-transitioning-swipeback");
		if (device.ios) $currentPageEl[0]._clientLeft = $currentPageEl[0].clientLeft;
		$pages.transform("");
		allowViewTouchMove = false;
		router.allowPageChange = false;
		const callbackData = {
			currentPageEl: $currentPageEl[0],
			previousPageEl: $previousPageEl[0]
		};
		if (pageChanged) {
			router.currentRoute = $previousPageEl[0].f7Page.route;
			router.currentPage = $previousPageEl[0];
			router.pageCallback("beforeOut", $currentPageEl, "current", "next", {
				route: $currentPageEl[0].f7Page.route,
				swipeBack: true
			});
			router.pageCallback("beforeIn", $previousPageEl, "previous", "current", {
				route: $previousPageEl[0].f7Page.route,
				swipeBack: true
			}, $currentPageEl[0]);
			$el.trigger("swipeback:beforechange", callbackData);
			router.emit("swipebackBeforeChange", callbackData);
		} else {
			$el.trigger("swipeback:beforereset", callbackData);
			router.emit("swipebackBeforeReset", callbackData);
		}
		$currentPageEl.transitionEnd(() => {
			$pages.removeClass("page-transitioning page-transitioning-swipeback");
			allowViewTouchMove = true;
			router.allowPageChange = true;
			if (pageChanged) {
				if (router.history.length === 1) router.history.unshift(router.url);
				router.history.pop();
				router.saveHistory();
				if (params.browserHistory) History.back();
				router.pageCallback("afterOut", $currentPageEl, "current", "next", {
					route: $currentPageEl[0].f7Page.route,
					swipeBack: true
				});
				router.pageCallback("afterIn", $previousPageEl, "previous", "current", {
					route: $previousPageEl[0].f7Page.route,
					swipeBack: true
				});
				router.pageCallback("beforeRemove", $currentPageEl, "next", { swipeBack: true });
				router.removePage($currentPageEl);
				$el.trigger("swipeback:afterchange", callbackData);
				router.emit("swipebackAfterChange", callbackData);
				router.emit("routeChanged", router.currentRoute, router.previousRoute, router);
				if (params.preloadPreviousPage) router.back(router.history[router.history.length - 2], { preload: true });
			} else {
				$el.trigger("swipeback:afterreset", callbackData);
				router.emit("swipebackAfterReset", callbackData);
			}
			if ($pageShadowEl && $pageShadowEl.length > 0) $pageShadowEl.remove();
			if ($pageOpacityEl && $pageOpacityEl.length > 0) $pageOpacityEl.remove();
		});
	}
	function attachEvents() {
		const passiveListener = app.touchEvents.start === "touchstart" ? {
			passive: true,
			capture: false
		} : false;
		$el.on(app.touchEvents.start, handleTouchStart, passiveListener);
		app.on("touchmove:active", handleTouchMove);
		app.on("touchend:passive", handleTouchEnd);
	}
	function detachEvents() {
		const passiveListener = app.touchEvents.start === "touchstart" ? {
			passive: true,
			capture: false
		} : false;
		$el.off(app.touchEvents.start, handleTouchStart, passiveListener);
		app.off("touchmove:active", handleTouchMove);
		app.off("touchend:passive", handleTouchEnd);
	}
	attachEvents();
	router.on("routerDestroy", detachEvents);
}
function redirect(direction, route, options) {
	const router = this;
	const r = route.route.redirect;
	const method = direction === "forward" ? "navigate" : "back";
	if (options.initial && router.params.browserHistory) {
		options.replaceState = true;
		options.history = true;
	}
	function redirectResolve(redirectUrl, redirectOptions = {}) {
		router.allowPageChange = true;
		router[method](redirectUrl, extend$1({}, options, redirectOptions));
	}
	function redirectReject() {
		router.allowPageChange = true;
	}
	if (typeof r === "function") {
		router.allowPageChange = false;
		const redirectUrl = r.call(router, {
			router,
			to: route,
			resolve: redirectResolve,
			reject: redirectReject,
			direction,
			app: router.app
		});
		if (redirectUrl && typeof redirectUrl === "string") {
			router.allowPageChange = true;
			return router[method](redirectUrl, options);
		}
		return router;
	}
	return router[method](r, options);
}
function processQueue(router, routerQueue, routeQueue, to, from, resolve, reject, direction) {
	const queue = [];
	if (Array.isArray(routeQueue)) queue.push(...routeQueue);
	else if (routeQueue && typeof routeQueue === "function") queue.push(routeQueue);
	if (routerQueue) {
		if (Array.isArray(routerQueue)) queue.push(...routerQueue);
		else queue.push(routerQueue);
	}
	function next() {
		if (queue.length === 0) {
			resolve();
			return;
		}
		queue.shift().call(router, {
			router,
			to,
			from,
			resolve() {
				next();
			},
			reject() {
				reject();
			},
			direction,
			app: router.app
		});
	}
	next();
}
function processRouteQueue(to, from, resolve, reject, direction) {
	const router = this;
	function enterNextRoute() {
		if (to && to.route && (router.params.routesBeforeEnter || to.route.beforeEnter)) {
			router.allowPageChange = false;
			processQueue(router, router.params.routesBeforeEnter, to.route.beforeEnter, to, from, () => {
				router.allowPageChange = true;
				resolve();
			}, () => {
				reject();
			}, direction);
		} else resolve();
	}
	function leaveCurrentRoute() {
		if (from && from.route && (router.params.routesBeforeLeave || from.route.beforeLeave)) {
			router.allowPageChange = false;
			processQueue(router, router.params.routesBeforeLeave, from.route.beforeLeave, to, from, () => {
				router.allowPageChange = true;
				enterNextRoute();
			}, () => {
				reject();
			}, direction);
		} else enterNextRoute();
	}
	leaveCurrentRoute();
}
function appRouterCheck(router, method) {
	if (!router.view) throw new Error(`Framework7: it is not allowed to use router methods on global app router. Use router methods only on related View, e.g. app.views.main.router.${method}(...)`);
}
function asyncComponent(router, component, resolve, reject) {
	function resolvePromise(componentPromise) {
		componentPromise.then((c) => {
			resolve({ component: c.default || c._default || c });
		}).catch((err) => {
			reject();
			throw new Error(err, { cause: err });
		});
	}
	if (component instanceof Promise) {
		resolvePromise(component);
		return;
	}
	const asyncComponentResult = component.call(router);
	if (asyncComponentResult instanceof Promise) resolvePromise(asyncComponentResult);
	else resolve({ component: asyncComponentResult });
}
function refreshPage(props = {}) {
	const router = this;
	appRouterCheck(router, "refreshPage");
	return router.navigate(router.currentRoute.url, {
		ignoreCache: true,
		reloadCurrent: true,
		props
	});
}
function forward(router, el, forwardOptions = {}) {
	const document = getDocument();
	const $el = dom7_default(el);
	const app = router.app;
	const view = router.view;
	const options = extend$1(false, {
		animate: router.params.animate,
		browserHistory: true,
		replaceState: false,
		history: true,
		reloadCurrent: router.params.reloadPages,
		reloadPrevious: false,
		reloadAll: false,
		clearPreviousHistory: false,
		reloadDetail: router.params.reloadDetail,
		on: {}
	}, forwardOptions);
	const masterDetailEnabled = router.params.masterDetailBreakpoint > 0;
	const isMaster = masterDetailEnabled && options.route && options.route.route && (options.route.route.master === true || typeof options.route.route.master === "function" && options.route.route.master(app, router));
	let masterPageEl;
	let otherDetailPageEl;
	let detailsInBetweenRemoved = 0;
	let currentRouteIsModal = router.currentRoute.modal;
	let modalType;
	if (!currentRouteIsModal) "popup popover sheet loginScreen actions customModal panel".split(" ").forEach((modalLoadProp) => {
		if (router.currentRoute && router.currentRoute.route && router.currentRoute.route[modalLoadProp]) {
			currentRouteIsModal = true;
			modalType = modalLoadProp;
		}
	});
	if (currentRouteIsModal) {
		const modalToClose = router.currentRoute.modal || router.currentRoute.route.modalInstance || app[modalType].get();
		const previousUrl = router.history[router.history.length - 2];
		let previousRoute = router.findMatchingRoute(previousUrl);
		if (!previousRoute && previousUrl) previousRoute = {
			url: previousUrl,
			path: previousUrl.split("?")[0],
			query: parseUrlQuery(previousUrl),
			route: {
				path: previousUrl.split("?")[0],
				url: previousUrl
			}
		};
		router.modalRemove(modalToClose);
	}
	const $viewEl = router.$el;
	const $newPage = $el;
	const reload = options.reloadPrevious || options.reloadCurrent || options.reloadAll;
	let $oldPage;
	router.allowPageChange = false;
	if ($newPage.length === 0) {
		router.allowPageChange = true;
		return router;
	}
	if ($newPage.length) router.removeThemeElements($newPage);
	if (options.route && options.route.route && options.route.route.keepAlive && !options.route.route.keepAliveData) options.route.route.keepAliveData = { pageEl: $el[0] };
	const $pagesInView = $viewEl.children(".page").filter((pageInView) => pageInView !== $newPage[0]);
	if (options.reloadPrevious && $pagesInView.length < 2) {
		router.allowPageChange = true;
		return router;
	}
	let isDetail;
	let reloadDetail;
	let isDetailRoot;
	if (masterDetailEnabled && !options.reloadAll) {
		for (let i = 0; i < $pagesInView.length; i += 1) if (!masterPageEl && $pagesInView[i].classList.contains("page-master")) {
			masterPageEl = $pagesInView[i];
			continue;
		}
		isDetail = !isMaster && masterPageEl;
		if (isDetail) {
			if (masterPageEl) {
				for (let i = 0; i < $pagesInView.length; i += 1) if ($pagesInView[i].classList.contains("page-master-detail")) {
					otherDetailPageEl = $pagesInView[i];
					continue;
				}
			}
		}
		reloadDetail = isDetail && options.reloadDetail && app.width >= router.params.masterDetailBreakpoint && masterPageEl;
	}
	if (isDetail) isDetailRoot = !otherDetailPageEl || reloadDetail || options.reloadAll || options.reloadCurrent;
	let newPagePosition = "next";
	if (options.reloadCurrent || options.reloadAll || reloadDetail) newPagePosition = "current";
	else if (options.reloadPrevious) newPagePosition = "previous";
	$newPage.removeClass("page-previous page-current page-next").addClass(`page-${newPagePosition}${isMaster ? " page-master" : ""}${isDetail ? " page-master-detail" : ""}${isDetailRoot ? " page-master-detail-root" : ""}`).trigger("page:unstack").trigger("page:position", { position: newPagePosition });
	router.emit("pageUnstack", $newPage[0]);
	router.emit("pagePosition", $newPage[0], newPagePosition);
	if (isMaster || isDetail) {
		$newPage.trigger("page:role", {
			role: isMaster ? "master" : "detail",
			root: !!isDetailRoot
		});
		router.emit("pageRole", $newPage[0], {
			role: isMaster ? "master" : "detail",
			detailRoot: !!isDetailRoot
		});
	}
	if (options.reloadCurrent || reloadDetail) {
		if (reloadDetail) {
			$oldPage = $pagesInView.filter((pageEl) => !pageEl.classList.contains("page-master"));
			if ($oldPage.length > 1 && masterPageEl) {
				detailsInBetweenRemoved = $oldPage.length - 1;
				dom7_default(masterPageEl).removeClass("page-master-stacked").trigger("page:masterunstack");
				router.emit("pageMasterUnstack", masterPageEl);
			}
		} else $oldPage = $pagesInView.eq($pagesInView.length - 1);
	} else if (options.reloadPrevious) $oldPage = $pagesInView.eq($pagesInView.length - 2);
	else if (options.reloadAll) $oldPage = $pagesInView.filter((pageEl) => pageEl !== $newPage[0]);
	else {
		const removedPageEls = [];
		if ($pagesInView.length > 1) {
			let i = 0;
			for (i = 0; i < $pagesInView.length - 1; i += 1) {
				if (masterPageEl && $pagesInView[i] === masterPageEl) {
					$pagesInView.eq(i).addClass("page-master-stacked");
					$pagesInView.eq(i).trigger("page:masterstack");
					router.emit("pageMasterStack", $pagesInView[i]);
					continue;
				}
				removedPageEls.push($pagesInView[i]);
				router.pageCallback("beforeRemove", $pagesInView[i], "previous", void 0, options);
				router.removePage($pagesInView[i]);
			}
		}
		$oldPage = $viewEl.children(".page").filter((pageEl) => pageEl !== $newPage[0] && removedPageEls.indexOf(pageEl) < 0);
	}
	if (isDetail && !options.reloadAll) {
		if ($oldPage.length > 1 || reloadDetail) $oldPage = $oldPage.filter((pageEl) => !pageEl.classList.contains("page-master"));
	}
	if (router.params.browserHistory && (options.browserHistory || options.replaceState) && !options.reloadPrevious) {
		const browserHistoryRoot = router.params.browserHistoryRoot || "";
		History[options.reloadCurrent || reloadDetail && otherDetailPageEl || options.reloadAll || options.replaceState ? "replace" : "push"](view.id, { url: options.route.url }, browserHistoryRoot + router.params.browserHistorySeparator + options.route.url);
	}
	if (!options.reloadPrevious) {
		router.currentPageEl = $newPage[0];
		router.currentRoute = options.route;
	}
	const url = options.route.url;
	if (options.history) {
		if (((options.reloadCurrent || reloadDetail && otherDetailPageEl) && router.history.length) > 0 || options.replaceState) {
			if (reloadDetail && detailsInBetweenRemoved > 0) {
				router.history = router.history.slice(0, router.history.length - detailsInBetweenRemoved);
				router.propsHistory = router.propsHistory.slice(0, router.propsHistory.length - detailsInBetweenRemoved);
			}
			router.history[router.history.length - (options.reloadPrevious ? 2 : 1)] = url;
			router.propsHistory[router.propsHistory.length - (options.reloadPrevious ? 2 : 1)] = options.props || {};
		} else if (options.reloadPrevious) {
			router.history[router.history.length - 2] = url;
			router.propsHistory[router.propsHistory.length - 2] = options.props || {};
		} else if (options.reloadAll) {
			router.history = [url];
			router.propsHistory = [options.props || {}];
		} else {
			router.history.push(url);
			router.propsHistory.push(options.props || {});
		}
	}
	router.saveHistory();
	const newPageInDom = $newPage.parents(document).length > 0;
	const f7Component = $newPage[0].f7Component;
	if (options.reloadPrevious) {
		if (f7Component && !newPageInDom) f7Component.mount((componentEl) => {
			dom7_default(componentEl).insertBefore($oldPage);
		});
		else $newPage.insertBefore($oldPage);
	} else if ($oldPage.next(".page")[0] !== $newPage[0]) {
		if (f7Component && !newPageInDom) f7Component.mount((componentEl) => {
			$viewEl.append(componentEl);
		});
		else $viewEl.append($newPage[0]);
	}
	if (!newPageInDom) router.pageCallback("mounted", $newPage, newPagePosition, reload ? newPagePosition : "current", options, $oldPage);
	else if (options.route && options.route.route && options.route.route.keepAlive && !$newPage[0].f7PageMounted) {
		$newPage[0].f7PageMounted = true;
		router.pageCallback("mounted", $newPage, newPagePosition, reload ? newPagePosition : "current", options, $oldPage);
	}
	if ((options.reloadCurrent || reloadDetail) && $oldPage.length > 0) {
		router.pageCallback("beforeOut", $oldPage, "current", void 0, options);
		router.pageCallback("afterOut", $oldPage, "current", void 0, options);
		router.pageCallback("beforeRemove", $oldPage, "current", void 0, options);
		router.removePage($oldPage);
	} else if (options.reloadAll) $oldPage.each((pageEl) => {
		const $oldPageEl = dom7_default(pageEl);
		if ($oldPageEl.hasClass("page-current")) {
			router.pageCallback("beforeOut", $oldPage, "current", void 0, options);
			router.pageCallback("afterOut", $oldPage, "current", void 0, options);
		}
		router.pageCallback("beforeRemove", $oldPageEl, "previous", void 0, options);
		router.removePage($oldPageEl);
	});
	else if (options.reloadPrevious) {
		router.pageCallback("beforeRemove", $oldPage, "previous", void 0, options);
		router.removePage($oldPage);
	}
	if (options.route.route.tab) router.tabLoad(options.route.route.tab, extend$1({}, options, {
		history: false,
		browserHistory: false
	}));
	if (masterDetailEnabled) view.checkMasterDetailBreakpoint();
	router.pageCallback("init", $newPage, newPagePosition, reload ? newPagePosition : "current", options, $oldPage);
	if (options.reloadCurrent || options.reloadAll || reloadDetail) {
		router.allowPageChange = true;
		router.pageCallback("beforeIn", $newPage, newPagePosition, "current", options);
		$newPage.removeAttr("aria-hidden");
		router.pageCallback("afterIn", $newPage, newPagePosition, "current", options);
		if (options.reloadCurrent && options.clearPreviousHistory) router.clearPreviousHistory();
		if (reloadDetail) router.setPagePosition(dom7_default(masterPageEl), "previous");
		return router;
	}
	if (options.reloadPrevious) {
		router.allowPageChange = true;
		return router;
	}
	router.pageCallback("beforeOut", $oldPage, "current", "previous", options);
	router.pageCallback("beforeIn", $newPage, "next", "current", options);
	function afterAnimation() {
		router.setPagePosition($newPage, "current", false);
		router.setPagePosition($oldPage, "previous", !$oldPage.hasClass("page-master"));
		router.allowPageChange = true;
		router.pageCallback("afterOut", $oldPage, "current", "previous", options);
		router.pageCallback("afterIn", $newPage, "next", "current", options);
		let keepOldPage = (router.params.preloadPreviousPage || router.params[`${app.theme}SwipeBack`]) && !isMaster;
		if (!keepOldPage) {
			if ($newPage.hasClass("smart-select-page") || $newPage.hasClass("photo-browser-page") || $newPage.hasClass("autocomplete-page") || $newPage.hasClass("color-picker-page")) keepOldPage = true;
		}
		if (!keepOldPage) {
			if (!($newPage.attr("data-name") && $newPage.attr("data-name") === "smart-select-page")) {
				router.pageCallback("beforeRemove", $oldPage, "previous", void 0, options);
				router.removePage($oldPage);
			}
		}
		if (options.clearPreviousHistory) router.clearPreviousHistory();
		router.emit("routeChanged", router.currentRoute, router.previousRoute, router);
		if (router.params.browserHistory) History.clearRouterQueue();
	}
	function setPositionClasses() {
		router.setPagePosition($oldPage, "current", false);
		router.setPagePosition($newPage, "next", false);
	}
	if (options.animate && !(isMaster && app.width >= router.params.masterDetailBreakpoint)) {
		const delay = router.params[`${router.app.theme}PageLoadDelay`];
		let transition = router.params.transition;
		if (options.transition) transition = options.transition;
		if (!transition && router.currentRoute && router.currentRoute.route) transition = router.currentRoute.route.transition;
		if (!transition && router.currentRoute && router.currentRoute.route.options) transition = router.currentRoute.route.options.transition;
		if (transition) $newPage[0].f7PageTransition = transition;
		if (delay) setTimeout(() => {
			setPositionClasses();
			router.animate($oldPage, $newPage, "forward", transition, () => {
				afterAnimation();
			});
		}, delay);
		else {
			setPositionClasses();
			router.animate($oldPage, $newPage, "forward", transition, () => {
				afterAnimation();
			});
		}
	} else afterAnimation();
	return router;
}
function load(router, loadParams = {}, loadOptions = {}, ignorePageChange) {
	if (!router.allowPageChange && !ignorePageChange) return router;
	const params = loadParams;
	const options = loadOptions;
	const { url, content, el, pageName, component, componentUrl } = params;
	if (!options.reloadCurrent && options.route && options.route.route && options.route.route.parentPath && router.currentRoute.route && router.currentRoute.route.parentPath === options.route.route.parentPath) {
		if (options.route.url === router.url) {
			router.allowPageChange = true;
			return false;
		}
		let sameParams = Object.keys(options.route.params).length === Object.keys(router.currentRoute.params).length;
		if (sameParams) Object.keys(options.route.params).forEach((paramName) => {
			if (!(paramName in router.currentRoute.params) || router.currentRoute.params[paramName] !== options.route.params[paramName]) sameParams = false;
		});
		if (sameParams) {
			if (options.route.route.tab) return router.tabLoad(options.route.route.tab, options);
			return false;
		}
		if (!sameParams && options.route.route.tab && router.currentRoute.route.tab && router.currentRoute.parentPath === options.route.parentPath) return router.tabLoad(options.route.route.tab, options);
	}
	if (options.route && options.route.url && router.url === options.route.url && !(options.reloadCurrent || options.reloadPrevious) && !router.params.allowDuplicateUrls) {
		router.allowPageChange = true;
		return false;
	}
	if (!options.route && url) {
		options.route = router.parseRouteUrl(url);
		extend$1(options.route, { route: {
			url,
			path: url
		} });
	}
	function resolve(pageEl, newOptions) {
		return forward(router, pageEl, extend$1(options, newOptions));
	}
	function reject() {
		router.allowPageChange = true;
		return router;
	}
	if (url || componentUrl || component) router.allowPageChange = false;
	if (content) forward(router, router.getPageEl(content), options);
	else if (el) forward(router, router.getPageEl(el), options);
	else if (pageName) forward(router, router.$el.children(`.page[data-name="${pageName}"]`).eq(0), options);
	else if (component || componentUrl) try {
		router.pageComponentLoader({
			routerEl: router.el,
			component,
			componentUrl,
			options,
			resolve,
			reject
		});
	} catch (err) {
		router.allowPageChange = true;
		throw err;
	}
	else if (url) {
		if (router.xhrAbortController) {
			router.xhrAbortController.abort();
			router.xhrAbortController = false;
		}
		router.xhrRequest(url, options).then((pageContent) => {
			forward(router, router.getPageEl(pageContent), options);
		}).catch(() => {
			router.allowPageChange = true;
		});
	}
	return router;
}
function navigate(navigateParams, navigateOptions = {}) {
	const router = this;
	if (router.swipeBackActive) return router;
	let url;
	let createRoute;
	let name;
	let path;
	let query;
	let params;
	let route;
	if (typeof navigateParams === "string") url = navigateParams;
	else {
		url = navigateParams.url;
		createRoute = navigateParams.route;
		name = navigateParams.name;
		path = navigateParams.path;
		query = navigateParams.query;
		params = navigateParams.params;
	}
	if (name || path) {
		url = router.generateUrl({
			path,
			name,
			params,
			query
		});
		if (url) return router.navigate(url, navigateOptions);
		return router;
	}
	const app = router.app;
	appRouterCheck(router, "navigate");
	if (url === "#" || url === "") return router;
	let navigateUrl = url.replace("./", "");
	if (navigateUrl[0] !== "/" && navigateUrl.indexOf("#") !== 0) {
		const currentPath = router.currentRoute.parentPath || router.currentRoute.path;
		navigateUrl = ((currentPath ? `${currentPath}/` : "/") + navigateUrl).replace("///", "/").replace("//", "/");
	}
	if (createRoute) route = extend$1(router.parseRouteUrl(navigateUrl), { route: extend$1({}, createRoute) });
	else route = router.findMatchingRoute(navigateUrl);
	if (!route) return router;
	if (route.route && route.route.viewName) {
		const anotherViewName = route.route.viewName;
		const anotherView = app.views[anotherViewName];
		if (!anotherView) throw new Error(`Framework7: There is no View with "${anotherViewName}" name that was specified in this route`);
		if (anotherView !== router.view) return anotherView.router.navigate(navigateParams, navigateOptions);
	}
	if (route.route.redirect) return redirect.call(router, "forward", route, navigateOptions);
	const options = {};
	if (route.route.options) extend$1(options, route.route.options, navigateOptions);
	else extend$1(options, navigateOptions);
	if (options.openIn && (!router.params.ignoreOpenIn || router.params.ignoreOpenIn && router.history.length > 0)) return router.openIn(router, navigateUrl, options);
	options.route = route;
	function resolve() {
		let routerLoaded = false;
		"popup popover sheet loginScreen actions customModal panel".split(" ").forEach((modalLoadProp) => {
			if (route.route[modalLoadProp] && !routerLoaded) {
				routerLoaded = true;
				router.modalLoad(modalLoadProp, route, options, "forward");
			}
		});
		if (route.route.keepAlive && route.route.keepAliveData) {
			load(router, { el: route.route.keepAliveData.pageEl }, options, false);
			routerLoaded = true;
		}
		"url content component pageName el componentUrl".split(" ").forEach((pageLoadProp) => {
			if (route.route[pageLoadProp] && !routerLoaded) {
				routerLoaded = true;
				load(router, { [pageLoadProp]: route.route[pageLoadProp] }, options, false);
			}
		});
		if (routerLoaded) return;
		function asyncResolve(resolveParams, resolveOptions) {
			router.allowPageChange = false;
			let resolvedAsModal = false;
			"popup popover sheet loginScreen actions customModal panel".split(" ").forEach((modalLoadProp) => {
				if (resolveParams[modalLoadProp]) {
					resolvedAsModal = true;
					const modalRoute = extend$1({}, route, { route: resolveParams });
					router.allowPageChange = true;
					router.modalLoad(modalLoadProp, modalRoute, extend$1(options, resolveOptions), "forward");
				}
			});
			if (resolvedAsModal) return;
			load(router, resolveParams, extend$1(options, resolveOptions), true);
		}
		function asyncReject() {
			router.allowPageChange = true;
		}
		if (route.route.async) {
			router.allowPageChange = false;
			route.route.async.call(router, {
				router,
				to: options.route,
				from: router.currentRoute,
				resolve: asyncResolve,
				reject: asyncReject,
				direction: "forward",
				app
			});
		}
		if (route.route.asyncComponent) asyncComponent(router, route.route.asyncComponent, asyncResolve, asyncReject);
	}
	function reject() {
		router.allowPageChange = true;
	}
	if (router.params.masterDetailBreakpoint > 0 && route.route.masterRoute) {
		let preloadMaster = true;
		let masterLoaded = false;
		if (router.currentRoute && router.currentRoute.route) {
			if ((router.currentRoute.route.master === true || typeof router.currentRoute.route.master === "function" && router.currentRoute.route.master(app, router)) && (router.currentRoute.route === route.route.masterRoute || router.currentRoute.route.path === route.route.masterRoute.path)) preloadMaster = false;
			if (router.currentRoute.route.masterRoute && (router.currentRoute.route.masterRoute === route.route.masterRoute || router.currentRoute.route.masterRoute.path === route.route.masterRoute.path)) {
				preloadMaster = false;
				masterLoaded = true;
			}
		}
		if (preloadMaster || masterLoaded && navigateOptions.reloadAll) {
			router.navigate({
				path: route.route.masterRoute.path,
				params: route.params || {}
			}, {
				animate: false,
				reloadAll: navigateOptions.reloadAll,
				reloadCurrent: navigateOptions.reloadCurrent,
				reloadPrevious: navigateOptions.reloadPrevious,
				browserHistory: !navigateOptions.initial,
				history: !navigateOptions.initial,
				once: { pageAfterIn() {
					router.navigate(navigateParams, extend$1({}, navigateOptions, {
						animate: false,
						reloadAll: false,
						reloadCurrent: false,
						reloadPrevious: false,
						history: !navigateOptions.initial,
						browserHistory: !navigateOptions.initial
					}));
				} }
			});
			return router;
		}
	}
	processRouteQueue.call(router, route, router.currentRoute, () => {
		if (route.route.modules) app.loadModules(Array.isArray(route.route.modules) ? route.route.modules : [route.route.modules]).then(() => {
			resolve();
		}).catch(() => {
			reject();
		});
		else resolve();
	}, () => {
		reject();
	}, "forward");
	return router;
}
function tabLoad(tabRoute, loadOptions = {}) {
	const router = this;
	const options = extend$1({
		animate: router.params.animate,
		browserHistory: true,
		history: true,
		parentPageEl: null,
		preload: false,
		on: {}
	}, loadOptions);
	let currentRoute;
	let previousRoute;
	if (options.route) {
		if (!options.preload && options.route !== router.currentRoute) {
			previousRoute = router.previousRoute;
			router.currentRoute = options.route;
		}
		if (options.preload) {
			currentRoute = options.route;
			previousRoute = router.currentRoute;
		} else {
			currentRoute = router.currentRoute;
			if (!previousRoute) previousRoute = router.previousRoute;
		}
		if (router.params.browserHistory && options.browserHistory && !options.reloadPrevious) History[router.params.browserHistoryTabs](router.view.id, { url: options.route.url }, (router.params.browserHistoryRoot || "") + router.params.browserHistorySeparator + options.route.url);
		if (options.history) {
			router.history[Math.max(router.history.length - 1, 0)] = options.route.url;
			router.saveHistory();
		}
	}
	const $parentPageEl = dom7_default(options.parentPageEl || router.currentPageEl);
	let tabEl;
	if ($parentPageEl.length && $parentPageEl.find(`#${tabRoute.id}`).length) tabEl = $parentPageEl.find(`#${tabRoute.id}`).eq(0);
	else if (router.view.selector) tabEl = `${router.view.selector} #${tabRoute.id}`;
	else tabEl = `#${tabRoute.id}`;
	const { $newTabEl, $oldTabEl, animated, onTabsChanged } = router.app.tab.show({
		tabEl,
		animate: options.animate,
		tabRoute: options.route
	});
	if ($newTabEl && $newTabEl.parents(".page").length > 0 && options.route) {
		const tabParentPageData = $newTabEl.parents(".page")[0].f7Page;
		if (tabParentPageData && options.route) tabParentPageData.route = options.route;
	}
	function onTabLoaded(contentEl) {
		router.removeThemeElements($newTabEl);
		let tabEventTarget = $newTabEl;
		if (typeof contentEl !== "string") tabEventTarget = dom7_default(contentEl);
		tabEventTarget.trigger("tab:init tab:mounted", tabRoute);
		router.emit("tabInit tabMounted", $newTabEl[0], tabRoute);
		if ($oldTabEl && $oldTabEl.length) {
			if (animated) onTabsChanged(() => {
				router.emit("routeChanged", router.currentRoute, router.previousRoute, router);
				if (router.params.unloadTabContent) router.tabRemove($oldTabEl, $newTabEl, tabRoute);
			});
			else {
				router.emit("routeChanged", router.currentRoute, router.previousRoute, router);
				if (router.params.unloadTabContent) router.tabRemove($oldTabEl, $newTabEl, tabRoute);
			}
		}
	}
	if ($newTabEl[0].f7RouterTabLoaded) {
		if (!$oldTabEl || !$oldTabEl.length) return router;
		if (animated) onTabsChanged(() => {
			router.emit("routeChanged", router.currentRoute, router.previousRoute, router);
		});
		else router.emit("routeChanged", router.currentRoute, router.previousRoute, router);
		return router;
	}
	function loadTab(loadTabParams, loadTabOptions) {
		const { url, content, el, component, componentUrl } = loadTabParams;
		function resolve(contentEl) {
			router.allowPageChange = true;
			if (!contentEl) return;
			if (typeof contentEl === "string") $newTabEl.html(contentEl);
			else {
				$newTabEl.html("");
				if (contentEl.f7Component) contentEl.f7Component.mount((componentEl) => {
					$newTabEl.append(componentEl);
				});
				else $newTabEl.append(contentEl);
			}
			$newTabEl[0].f7RouterTabLoaded = true;
			onTabLoaded(contentEl);
		}
		function reject() {
			router.allowPageChange = true;
			return router;
		}
		if (content) resolve(content);
		else if (el) resolve(el);
		else if (component || componentUrl) try {
			router.tabComponentLoader({
				tabEl: $newTabEl[0],
				component,
				componentUrl,
				options: loadTabOptions,
				resolve,
				reject
			});
		} catch (err) {
			router.allowPageChange = true;
			throw err;
		}
		else if (url) {
			if (router.xhrAbortController) {
				router.xhrAbortController.abort();
				router.xhrAbortController = false;
			}
			router.xhrRequest(url, loadTabOptions).then((tabContent) => {
				resolve(tabContent);
			}).catch(() => {
				router.allowPageChange = true;
			});
		}
	}
	let hasContentLoadProp;
	"url content component el componentUrl".split(" ").forEach((tabLoadProp) => {
		if (tabRoute[tabLoadProp]) {
			hasContentLoadProp = true;
			loadTab({ [tabLoadProp]: tabRoute[tabLoadProp] }, options);
		}
	});
	function asyncResolve(resolveParams, resolveOptions) {
		loadTab(resolveParams, extend$1(options, resolveOptions));
	}
	function asyncReject() {
		router.allowPageChange = true;
	}
	if (tabRoute.async) tabRoute.async.call(router, {
		router,
		to: currentRoute,
		from: previousRoute,
		resolve: asyncResolve,
		reject: asyncReject,
		app: router.app
	});
	else if (tabRoute.asyncComponent) asyncComponent(router, tabRoute.asyncComponent, asyncResolve, asyncReject);
	else if (!hasContentLoadProp) router.allowPageChange = true;
	return router;
}
function tabRemove($oldTabEl, $newTabEl, tabRoute) {
	const router = this;
	let hasTabComponentChild;
	if ($oldTabEl[0]) {
		$oldTabEl[0].f7RouterTabLoaded = false;
		delete $oldTabEl[0].f7RouterTabLoaded;
	}
	$oldTabEl.children().each((tabChild) => {
		if (tabChild.f7Component) {
			hasTabComponentChild = true;
			dom7_default(tabChild).trigger("tab:beforeremove", tabRoute);
			tabChild.f7Component.destroy();
		}
	});
	if (!hasTabComponentChild) $oldTabEl.trigger("tab:beforeremove", tabRoute);
	router.emit("tabBeforeRemove", $oldTabEl[0], $newTabEl[0], tabRoute);
	router.removeTabContent($oldTabEl[0], tabRoute);
}
function modalLoad(modalType, route, loadOptions = {}, direction) {
	const router = this;
	const app = router.app;
	const isPanel = modalType === "panel";
	const modalOrPanel = isPanel ? "panel" : "modal";
	const options = extend$1({
		animate: router.params.animate,
		browserHistory: true,
		history: true,
		on: {},
		once: {}
	}, loadOptions);
	const modalParams = extend$1({}, route.route[modalType]);
	const modalRoute = route.route;
	const routeCallback = (modal, name) => {
		const { on, once } = options;
		let callback;
		if (name === "open") callback = on.modalOpen || once.modalOpen || on.panelOpen || once.panelOpen;
		if (name === "close") callback = on.modalClose || once.modalClose || on.panelClose || once.panelClose;
		if (name === "closed") callback = on.modalClosed || once.modalClosed || on.panelClosed || once.panelClosed;
		if (callback) callback(modal);
	};
	function onModalLoaded() {
		const modal = app[modalType].create(modalParams);
		modalRoute.modalInstance = modal;
		const hasEl = modal.el;
		function closeOnSwipeBack() {
			modal.close();
		}
		modal.on(`${modalOrPanel}Open`, () => {
			if (!hasEl) {
				router.removeThemeElements(modal.el);
				modal.$el.trigger(`${modalType.toLowerCase()}:init ${modalType.toLowerCase()}:mounted`, route, modal);
				router.emit(`${!isPanel ? "modalInit" : ""} ${modalType}Init ${modalType}Mounted`, modal.el, route, modal);
			}
			router.once("swipeBackMove", closeOnSwipeBack);
			routeCallback(modal, "open");
		});
		modal.on(`${modalOrPanel}Close`, () => {
			router.off("swipeBackMove", closeOnSwipeBack);
			if (!modal.closeByRouter) router.back();
			routeCallback(modal, "close");
		});
		modal.on(`${modalOrPanel}Closed`, () => {
			modal.$el.trigger(`${modalType.toLowerCase()}:beforeremove`, route, modal);
			modal.emit(`${!isPanel ? "modalBeforeRemove " : ""}${modalType}BeforeRemove`, modal.el, route, modal);
			const modalComponent = modal.el.f7Component;
			routeCallback(modal, "closed");
			if (modalComponent) modalComponent.destroy();
			nextTick(() => {
				if (modalComponent || modalParams.component || modalParams.asyncComponent || modalParams.async) router.removeModal(modal.el);
				modal.destroy();
				delete modal.route;
				delete modalRoute.modalInstance;
			});
		});
		if (options.route) {
			if (router.params.browserHistory && options.browserHistory) History.push(router.view.id, {
				url: options.route.url,
				modal: modalType
			}, (router.params.browserHistoryRoot || "") + router.params.browserHistorySeparator + options.route.url);
			if (options.route !== router.currentRoute) {
				modal.route = extend$1(options.route, { modal });
				router.currentRoute = modal.route;
			}
			if (options.history && !options.reloadCurrent) {
				router.history.push(options.route.url);
				router.saveHistory();
			}
		}
		if (hasEl) {
			router.removeThemeElements(modal.el);
			modal.$el.trigger(`${modalType.toLowerCase()}:init ${modalType.toLowerCase()}:mounted`, route, modal);
			router.emit(`${modalOrPanel}Init ${modalType}Init ${modalType}Mounted`, modal.el, route, modal);
		}
		modal.open(options.animate === false || options.animate === true ? options.animate : void 0);
	}
	function loadModal(loadModalParams, loadModalOptions) {
		const { url, content, component, componentUrl } = loadModalParams;
		function resolve(contentEl) {
			if (contentEl) {
				if (typeof contentEl === "string") modalParams.content = contentEl;
				else if (contentEl.f7Component) contentEl.f7Component.mount((componentEl) => {
					modalParams.el = componentEl;
					app.$el.append(componentEl);
				});
				else modalParams.el = contentEl;
				onModalLoaded();
			}
		}
		function reject() {
			router.allowPageChange = true;
			return router;
		}
		if (content) resolve(content);
		else if (component || componentUrl) try {
			router.modalComponentLoader({
				rootEl: app.el,
				component,
				componentUrl,
				options: loadModalOptions,
				resolve,
				reject
			});
		} catch (err) {
			router.allowPageChange = true;
			throw err;
		}
		else if (url) {
			if (router.xhrAbortController) {
				router.xhrAbortController.abort();
				router.xhrAbortController = false;
			}
			router.xhrRequest(url, loadModalOptions).then((modalContent) => {
				modalParams.content = modalContent;
				onModalLoaded();
			}).catch(() => {
				router.allowPageChange = true;
			});
		} else onModalLoaded();
	}
	let foundLoadProp;
	"url content component el componentUrl template".split(" ").forEach((modalLoadProp) => {
		if (modalParams[modalLoadProp] && !foundLoadProp) {
			foundLoadProp = true;
			loadModal({ [modalLoadProp]: modalParams[modalLoadProp] }, options);
		}
	});
	if (!foundLoadProp && modalType === "actions") onModalLoaded();
	function asyncResolve(resolveParams, resolveOptions) {
		loadModal(resolveParams, extend$1(options, resolveOptions));
	}
	function asyncReject() {
		router.allowPageChange = true;
	}
	if (modalParams.async) modalParams.async.call(router, {
		router,
		to: options.route,
		from: router.currentRoute,
		resolve: asyncResolve,
		reject: asyncReject,
		direction,
		app
	});
	if (modalParams.asyncComponent) asyncComponent(router, modalParams.asyncComponent, asyncResolve, asyncReject);
	return router;
}
function modalRemove(modal) {
	extend$1(modal, { closeByRouter: true });
	modal.close();
}
function backward(router, el, backwardOptions) {
	const device = getDevice();
	const document = getDocument();
	const $el = dom7_default(el);
	const app = router.app;
	const view = router.view;
	const options = extend$1(false, {
		animate: router.params.animate,
		browserHistory: true,
		replaceState: false
	}, backwardOptions);
	const masterDetailEnabled = router.params.masterDetailBreakpoint > 0;
	const isMaster = masterDetailEnabled && options.route && options.route.route && (options.route.route.master === true || typeof options.route.route.master === "function" && options.route.route.master(app, router));
	let masterPageEl;
	let masterPageRemoved;
	const $newPage = $el;
	const $oldPage = router.$el.children(".page-current");
	const initialPreload = $oldPage.length === 0 && options.preload;
	const currentIsMaster = masterDetailEnabled && $oldPage.hasClass("page-master");
	if ($newPage.length) router.removeThemeElements($newPage);
	router.allowPageChange = false;
	if ($newPage.length === 0 || $oldPage.length === 0 && !options.preload) {
		router.allowPageChange = true;
		return router;
	}
	router.removeThemeElements($newPage);
	if (options.route && options.route.route && options.route.route.keepAlive && !options.route.route.keepAliveData) options.route.route.keepAliveData = { pageEl: $el[0] };
	let isDetail;
	let isDetailRoot;
	if (masterDetailEnabled) {
		const $pagesInView = router.$el.children(".page").filter((pageInView) => pageInView !== $newPage[0]);
		for (let i = 0; i < $pagesInView.length; i += 1) if (!masterPageEl && $pagesInView[i].classList.contains("page-master")) {
			masterPageEl = $pagesInView[i];
			continue;
		}
		isDetail = !isMaster && masterPageEl && router.history.indexOf(options.route.url) > router.history.indexOf(masterPageEl.f7Page.route.url);
		if (!isDetail && !isMaster && masterPageEl && masterPageEl.f7Page && options.route.route.masterRoute) isDetail = options.route.route.masterRoute.path === masterPageEl.f7Page.route.route.path;
	}
	if (isDetail && masterPageEl && masterPageEl.f7Page) isDetailRoot = router.history.indexOf(options.route.url) - router.history.indexOf(masterPageEl.f7Page.route.url) === 1;
	$newPage.addClass(`page-${initialPreload ? "current" : "previous"}${isMaster ? " page-master" : ""}${isDetail ? " page-master-detail" : ""}${isDetailRoot ? " page-master-detail-root" : ""}`).removeAttr("aria-hidden").trigger("page:unstack").trigger("page:position", { position: initialPreload ? "current" : "previous" });
	router.emit("pageUnstack", $newPage[0]);
	router.emit("pagePosition", $newPage[0], initialPreload ? "current" : "previous");
	if (isMaster || isDetail) {
		$newPage.trigger("page:role", {
			role: isMaster ? "master" : "detail",
			root: !!isDetailRoot
		});
		router.emit("pageRole", $newPage[0], {
			role: isMaster ? "master" : "detail",
			detailRoot: !!isDetailRoot
		});
	}
	let backIndex;
	if (options.force) {
		if ($oldPage.prev(".page-previous").length >= 0) {
			if (router.history.indexOf(options.route.url) >= 0) {
				backIndex = router.history.length - router.history.indexOf(options.route.url) - 1;
				router.history = router.history.slice(0, router.history.indexOf(options.route.url) + 2);
				router.propsHistory = router.propsHistory.slice(0, router.history.indexOf(options.route.url) + 2);
				view.history = router.history;
			} else if (router.history[[router.history.length - 2]]) router.propsHistory[router.propsHistory.length - 2] = options.props || {};
			else {
				router.history.unshift(router.url);
				router.propsHistory.unshift(options.props || {});
			}
			const $pageToRemove = $oldPage.prev(".page-previous");
			if ($pageToRemove.length > 0) {
				router.pageCallback("beforeRemove", $pageToRemove, "previous", void 0, options);
				if ($pageToRemove[0] === masterPageEl) masterPageRemoved = true;
				router.removePage($pageToRemove);
			}
		}
	}
	const newPageInDom = $newPage.parents(document).length > 0;
	const f7Component = $newPage[0].f7Component;
	function insertPage() {
		if (initialPreload) {
			if (!newPageInDom && f7Component) f7Component.mount((componentEl) => {
				router.$el.append(componentEl);
			});
			else router.$el.append($newPage);
		}
		if ($newPage.next($oldPage).length === 0) {
			if (!newPageInDom && f7Component) f7Component.mount((componentEl) => {
				dom7_default(componentEl).insertBefore($oldPage);
			});
			else $newPage.insertBefore($oldPage);
		}
		if (!newPageInDom) router.pageCallback("mounted", $newPage, "previous", "current", options, $oldPage);
		else if (options.route && options.route.route && options.route.route.keepAlive && !$newPage[0].f7PageMounted) {
			$newPage[0].f7PageMounted = true;
			router.pageCallback("mounted", $newPage, "previous", "current", options, $oldPage);
		}
	}
	if (options.preload) {
		insertPage();
		if (options.route.route.tab) router.tabLoad(options.route.route.tab, extend$1({}, options, {
			history: false,
			browserHistory: false,
			preload: true
		}));
		if (isMaster) {
			$newPage.removeClass("page-master-stacked").trigger("page:masterunstack");
			router.emit("pageMasterUnstack", $newPage[0]);
		}
		router.pageCallback("init", $newPage, "previous", "current", options, $oldPage);
		if (initialPreload) {
			router.pageCallback("beforeIn", $newPage, "current", void 0, options);
			router.pageCallback("afterIn", $newPage, "current", void 0, options);
		}
		const $previousPages = $newPage.prevAll(".page-previous:not(.page-master)");
		if ($previousPages.length > 0) $previousPages.each((pageToRemove) => {
			const $pageToRemove = dom7_default(pageToRemove);
			router.pageCallback("beforeRemove", $pageToRemove, "previous", void 0);
			router.removePage($pageToRemove);
		});
		router.allowPageChange = true;
		return router;
	}
	if (!(device.ie || device.edge || device.firefox && !device.ios)) {
		if (router.params.browserHistory && options.browserHistory) {
			if (options.replaceState) {
				const browserHistoryRoot = router.params.browserHistoryRoot || "";
				History.replace(view.id, { url: options.route.url }, browserHistoryRoot + router.params.browserHistorySeparator + options.route.url);
			} else if (backIndex) History.go(-backIndex);
			else History.back();
		}
	}
	if (options.replaceState) {
		router.history[router.history.length - 1] = options.route.url;
		router.propsHistory[router.propsHistory.length - 1] = options.props || {};
	} else {
		if (router.history.length === 1) {
			router.history.unshift(router.url);
			router.propsHistory.unshift(options.props || {});
		}
		router.history.pop();
		router.propsHistory.pop();
	}
	router.saveHistory();
	router.currentPageEl = $newPage[0];
	router.currentRoute = options.route;
	if (device.ie || device.edge || device.firefox && !device.ios) {
		if (router.params.browserHistory && options.browserHistory) {
			if (options.replaceState) {
				const browserHistoryRoot = router.params.browserHistoryRoot || "";
				History.replace(view.id, { url: options.route.url }, browserHistoryRoot + router.params.browserHistorySeparator + options.route.url);
			} else if (backIndex) History.go(-backIndex);
			else History.back();
		}
	}
	insertPage();
	if (options.route.route.tab) router.tabLoad(options.route.route.tab, extend$1({}, options, {
		history: false,
		browserHistory: false
	}));
	if (masterDetailEnabled && (currentIsMaster || masterPageRemoved)) view.checkMasterDetailBreakpoint(false);
	router.pageCallback("init", $newPage, "previous", "current", options, $oldPage);
	router.pageCallback("beforeOut", $oldPage, "current", "next", options);
	router.pageCallback("beforeIn", $newPage, "previous", "current", options);
	function afterAnimation() {
		router.setPagePosition($newPage, "current", false);
		router.setPagePosition($oldPage, "next", true);
		router.pageCallback("afterOut", $oldPage, "current", "next", options);
		router.pageCallback("afterIn", $newPage, "previous", "current", options);
		router.pageCallback("beforeRemove", $oldPage, "next", void 0, options);
		router.removePage($oldPage);
		router.allowPageChange = true;
		router.emit("routeChanged", router.currentRoute, router.previousRoute, router);
		if ((router.params.preloadPreviousPage || router.params[`${app.theme}SwipeBack`]) && router.history[router.history.length - 2] && !isMaster) router.back(router.history[router.history.length - 2], {
			preload: true,
			props: router.propsHistory[router.propsHistory.length - 2] || {}
		});
		if (router.params.browserHistory) History.clearRouterQueue();
	}
	function setPositionClasses() {
		router.setPagePosition($oldPage, "current");
		router.setPagePosition($newPage, "previous", false);
	}
	if (options.animate && !(currentIsMaster && app.width >= router.params.masterDetailBreakpoint)) {
		let transition = router.params.transition;
		if ($oldPage[0] && $oldPage[0].f7PageTransition) {
			transition = $oldPage[0].f7PageTransition;
			delete $oldPage[0].f7PageTransition;
		}
		if (options.transition) transition = options.transition;
		if (!transition && router.previousRoute && router.previousRoute.route) transition = router.previousRoute.route.transition;
		if (!transition && router.previousRoute && router.previousRoute.route && router.previousRoute.route.options) transition = router.previousRoute.route.options.transition;
		setPositionClasses();
		router.animate($oldPage, $newPage, "backward", transition, () => {
			afterAnimation();
		});
	} else afterAnimation();
	return router;
}
function loadBack(router, backParams, backOptions, ignorePageChange) {
	if (!router.allowPageChange && !ignorePageChange) return router;
	const params = backParams;
	const options = backOptions;
	const { url, content, el, pageName, component, componentUrl } = params;
	if (options.route.url && router.url === options.route.url && !(options.reloadCurrent || options.reloadPrevious) && !router.params.allowDuplicateUrls) {
		router.allowPageChange = true;
		return false;
	}
	if (!options.route && url) options.route = router.parseRouteUrl(url);
	function resolve(pageEl, newOptions) {
		return backward(router, pageEl, extend$1(options, newOptions));
	}
	function reject() {
		router.allowPageChange = true;
		return router;
	}
	if (url || componentUrl || component) router.allowPageChange = false;
	if (content) backward(router, router.getPageEl(content), options);
	else if (el) backward(router, router.getPageEl(el), options);
	else if (pageName) backward(router, router.$el.children(`.page[data-name="${pageName}"]`).eq(0), options);
	else if (component || componentUrl) try {
		router.pageComponentLoader({
			routerEl: router.el,
			component,
			componentUrl,
			options,
			resolve,
			reject,
			direction: "backward"
		});
	} catch (err) {
		router.allowPageChange = true;
		throw err;
	}
	else if (url) {
		if (router.xhrAbortController) {
			router.xhrAbortController.abort();
			router.xhrAbortController = false;
		}
		router.xhrRequest(url, options).then((pageContent) => {
			backward(router, router.getPageEl(pageContent), options);
		}).catch(() => {
			router.allowPageChange = true;
		});
	}
	return router;
}
function back(...args) {
	const router = this;
	const device = getDevice();
	if (router.swipeBackActive) return router;
	let navigateUrl;
	let navigateOptions;
	let navigateProps;
	let route;
	if (typeof args[0] === "object") navigateOptions = args[0] || {};
	else {
		navigateUrl = args[0];
		navigateOptions = args[1] || {};
	}
	const { name, params, query } = navigateOptions;
	if (name) {
		navigateUrl = router.generateUrl({
			name,
			params,
			query
		});
		if (navigateUrl) return router.back(navigateUrl, extend$1({}, navigateOptions, {
			name: null,
			params: null,
			query: null
		}));
		return router;
	}
	const app = router.app;
	appRouterCheck(router, "back");
	let currentRouteIsModal = router.currentRoute.modal;
	let modalType;
	if (!currentRouteIsModal) "popup popover sheet loginScreen actions customModal panel".split(" ").forEach((modalLoadProp) => {
		if (router.currentRoute.route[modalLoadProp]) {
			currentRouteIsModal = true;
			modalType = modalLoadProp;
		}
	});
	if (currentRouteIsModal && !navigateOptions.preload) {
		const modalToClose = router.currentRoute.modal || router.currentRoute.route.modalInstance || app[modalType].get();
		const previousUrl = router.history[router.history.length - 2];
		let previousRoute;
		if (modalToClose && modalToClose.$el) {
			const prevOpenedModals = modalToClose.$el.prevAll(".modal-in");
			if (prevOpenedModals.length && prevOpenedModals[0].f7Modal) {
				const modalEl = prevOpenedModals[0];
				if (!router.$el.parents(modalEl).length) previousRoute = modalEl.f7Modal.route;
			}
		}
		if (!previousRoute) previousRoute = router.findMatchingRoute(previousUrl);
		if (!previousRoute && previousUrl) previousRoute = {
			url: previousUrl,
			path: previousUrl.split("?")[0],
			query: parseUrlQuery(previousUrl),
			route: {
				path: previousUrl.split("?")[0],
				url: previousUrl
			}
		};
		if (!navigateUrl || navigateUrl.replace(/[# ]/g, "").trim().length === 0) {
			if (!previousRoute || !modalToClose) return router;
		}
		const forceOtherUrl = navigateOptions.force && previousRoute && navigateUrl;
		if (previousRoute && modalToClose) {
			const isBrokenBrowserHistory = device.ie || device.edge || device.firefox && !device.ios;
			const needHistoryBack = router.params.browserHistory && navigateOptions.browserHistory !== false;
			const currentRouteWithoutBrowserHistory = router.currentRoute && router.currentRoute.route && router.currentRoute.route.options && router.currentRoute.route.options.browserHistory === false;
			if (needHistoryBack && !isBrokenBrowserHistory && !currentRouteWithoutBrowserHistory) History.back();
			router.currentRoute = previousRoute;
			router.history.pop();
			router.propsHistory.pop();
			router.saveHistory();
			if (needHistoryBack && isBrokenBrowserHistory && !currentRouteWithoutBrowserHistory) History.back();
			router.modalRemove(modalToClose);
			if (forceOtherUrl) router.navigate(navigateUrl, { reloadCurrent: true });
		} else if (modalToClose) {
			router.modalRemove(modalToClose);
			if (navigateUrl) router.navigate(navigateUrl, { reloadCurrent: true });
		}
		return router;
	}
	let $previousPage = router.$el.children(".page-current").prevAll(".page-previous:not(.page-master)").eq(0);
	let skipMaster;
	if (router.params.masterDetailBreakpoint > 0) {
		const classes = [];
		router.$el.children(".page").each((pageEl) => {
			classes.push(pageEl.className);
		});
		const $previousMaster = router.$el.children(".page-current").prevAll(".page-master").eq(0);
		if ($previousMaster.length) {
			const expectedPreviousPageUrl = router.history[router.history.length - 2];
			const expectedPreviousPageRoute = router.findMatchingRoute(expectedPreviousPageUrl);
			if (expectedPreviousPageRoute && $previousMaster[0].f7Page && expectedPreviousPageRoute.route === $previousMaster[0].f7Page.route.route) {
				$previousPage = $previousMaster;
				if (!navigateOptions.preload) skipMaster = app.width >= router.params.masterDetailBreakpoint;
			}
		}
	}
	if (!navigateOptions.force && $previousPage.length && !skipMaster) {
		const previousPageObj = $previousPage[0].f7Page;
		if (router.params.browserHistory && previousPageObj && router.history[router.history.length - 2] !== previousPageObj.route.url) {
			router.back(router.history[router.history.length - 2], extend$1(navigateOptions, {
				force: true,
				props: router.propsHistory[router.propsHistory.length - 2] || {}
			}));
			return router;
		}
		if (previousPageObj) {
			const previousPageRoute = previousPageObj.route;
			processRouteQueue.call(router, previousPageRoute, router.currentRoute, () => {
				loadBack(router, { el: $previousPage }, extend$1(navigateOptions, { route: previousPageRoute }));
			}, () => {}, "backward");
			return router;
		}
	}
	if (navigateUrl === "#") navigateUrl = void 0;
	if (navigateUrl && navigateUrl[0] !== "/" && navigateUrl.indexOf("#") !== 0) navigateUrl = ((router.path || "/") + navigateUrl).replace("//", "/");
	if (!navigateUrl && router.history.length > 1) {
		navigateUrl = router.history[router.history.length - 2];
		navigateProps = router.propsHistory[router.propsHistory.length - 2] || {};
	}
	if (skipMaster && !navigateOptions.force && router.history[router.history.length - 3]) return router.back(router.history[router.history.length - 3], extend$1({}, navigateOptions || {}, {
		force: true,
		animate: false,
		props: router.propsHistory[router.propsHistory.length - 3] || {}
	}));
	if (skipMaster && !navigateOptions.force) return router;
	route = router.findMatchingRoute(navigateUrl);
	if (!route) {
		if (navigateUrl) route = {
			url: navigateUrl,
			path: navigateUrl.split("?")[0],
			query: parseUrlQuery(navigateUrl),
			route: {
				path: navigateUrl.split("?")[0],
				url: navigateUrl
			}
		};
	}
	if (!route) return router;
	if (route.route.redirect) return redirect.call(router, "backward", route, navigateOptions);
	const options = {};
	if (route.route.options) extend$1(options, route.route.options, navigateOptions, { props: navigateProps || {} });
	else extend$1(options, navigateOptions, { props: navigateProps || {} });
	options.route = route;
	function resolve() {
		let routerLoaded = false;
		if (route.route.keepAlive && route.route.keepAliveData) {
			loadBack(router, { el: route.route.keepAliveData.pageEl }, options);
			routerLoaded = true;
		}
		"url content component pageName el componentUrl".split(" ").forEach((pageLoadProp) => {
			if (route.route[pageLoadProp] && !routerLoaded) {
				routerLoaded = true;
				loadBack(router, { [pageLoadProp]: route.route[pageLoadProp] }, options);
			}
		});
		if (routerLoaded) return;
		function asyncResolve(resolveParams, resolveOptions) {
			router.allowPageChange = false;
			loadBack(router, resolveParams, extend$1(options, resolveOptions), true);
		}
		function asyncReject() {
			router.allowPageChange = true;
		}
		if (route.route.async) {
			router.allowPageChange = false;
			route.route.async.call(router, {
				router,
				to: route,
				from: router.currentRoute,
				resolve: asyncResolve,
				reject: asyncReject,
				direction: "backward",
				app
			});
		}
		if (route.route.asyncComponent) asyncComponent(router, route.route.asyncComponent, asyncResolve, asyncReject);
	}
	function reject() {
		router.allowPageChange = true;
	}
	if (options.preload) resolve();
	else processRouteQueue.call(router, route, router.currentRoute, () => {
		if (route.route.modules) app.loadModules(Array.isArray(route.route.modules) ? route.route.modules : [route.route.modules]).then(() => {
			resolve();
		}).catch(() => {
			reject();
		});
		else resolve();
	}, () => {
		reject();
	}, "backward");
	return router;
}
function clearPreviousPages(router) {
	appRouterCheck(router, "clearPreviousPages");
	router.$el.children(".page").filter((pageInView) => {
		if (router.currentRoute && (router.currentRoute.modal || router.currentRoute.panel)) return true;
		return pageInView !== router.currentPageEl;
	}).each((pageEl) => {
		const $oldPageEl = dom7_default(pageEl);
		router.pageCallback("beforeRemove", $oldPageEl, "previous", void 0, {});
		router.removePage($oldPageEl);
	});
}
function clearPreviousHistory() {
	const router = this;
	appRouterCheck(router, "clearPreviousHistory");
	const url = router.history[router.history.length - 1];
	clearPreviousPages(router);
	router.history = [url];
	router.view.history = [url];
	router.saveHistory();
}
var Router = class extends Framework7Class {
	constructor(app, view) {
		super({}, [typeof view === "undefined" ? app : view]);
		const router = this;
		router.isAppRouter = typeof view === "undefined";
		if (router.isAppRouter) extend$1(false, router, {
			app,
			params: app.params.view,
			routes: app.routes || [],
			cache: app.cache
		});
		else extend$1(false, router, {
			app,
			view,
			viewId: view.id,
			id: view.params.routerId,
			params: view.params,
			routes: view.routes,
			history: view.history,
			propsHistory: [],
			scrollHistory: view.scrollHistory,
			cache: app.cache,
			initialPages: []
		});
		router.useModules();
		router.allowPageChange = true;
		let currentRoute = {};
		let previousRoute = {};
		Object.defineProperty(router, "currentRoute", {
			enumerable: true,
			configurable: true,
			set(newRoute = {}) {
				previousRoute = extend$1({}, currentRoute);
				currentRoute = newRoute;
				if (!currentRoute) return;
				router.url = currentRoute.url;
				router.emit("routeChange", newRoute, previousRoute, router);
			},
			get() {
				return currentRoute;
			}
		});
		Object.defineProperty(router, "previousRoute", {
			enumerable: true,
			configurable: true,
			get() {
				return previousRoute;
			},
			set(newRoute) {
				previousRoute = newRoute;
			}
		});
		return router;
	}
	mount() {
		const router = this;
		const view = router.view;
		extend$1(false, router, {
			tempDom: getDocument().createElement("div"),
			$el: view.$el,
			el: view.el
		});
		router.emit("local::mount routerMount", router);
	}
	animate($oldPageEl, $newPageEl, direction, transition, callback) {
		const router = this;
		if (router.params.animateCustom) {
			router.params.animateCustom.apply(router, [
				$oldPageEl,
				$newPageEl,
				direction,
				callback
			]);
			return;
		}
		const ios = router.app.theme === "ios";
		if (transition) {
			const routerCustomTransitionClass = `router-transition-custom router-transition-${transition}-${direction}`;
			const onCustomTransitionDone = () => {
				router.$el.removeClass(routerCustomTransitionClass);
				if (callback) callback();
			};
			(direction === "forward" ? $newPageEl : $oldPageEl).animationEnd(onCustomTransitionDone);
			router.$el.addClass(routerCustomTransitionClass);
			return;
		}
		const routerTransitionClass = `router-transition-${direction} router-transition`;
		function onDone() {
			router.$el.removeClass(routerTransitionClass);
			if (callback) callback();
		}
		(direction === "forward" ? $newPageEl : ios ? $oldPageEl : $newPageEl).animationEnd(() => {
			onDone();
		});
		router.$el.addClass(routerTransitionClass);
	}
	removeModal(modalEl) {
		this.removeEl(modalEl);
	}
	removeTabContent(tabEl) {
		dom7_default(tabEl).html("");
	}
	removePage(el) {
		const $el = dom7_default(el);
		const f7Page = $el && $el[0] && $el[0].f7Page;
		const router = this;
		if (f7Page && f7Page.route && f7Page.route.route && f7Page.route.route.keepAlive) {
			$el.remove();
			return;
		}
		router.removeEl(el);
	}
	removeEl(el) {
		if (!el) return;
		const router = this;
		const $el = dom7_default(el);
		if ($el.length === 0) return;
		$el.find(".tab").each((tabEl) => {
			dom7_default(tabEl).children().each((tabChild) => {
				if (tabChild.f7Component) {
					dom7_default(tabChild).trigger("tab:beforeremove");
					tabChild.f7Component.destroy();
				}
			});
		});
		if ($el[0].f7Component && $el[0].f7Component.destroy) $el[0].f7Component.destroy();
		if (!router.params.removeElements) return;
		if (router.params.removeElementsWithTimeout) setTimeout(() => {
			$el.remove();
		}, router.params.removeElementsTimeout);
		else $el.remove();
	}
	getPageEl(content) {
		const router = this;
		if (typeof content === "string") router.tempDom.innerHTML = content;
		else {
			if (dom7_default(content).hasClass("page")) return content;
			router.tempDom.innerHTML = "";
			dom7_default(router.tempDom).append(content);
		}
		return router.findElement(".page", router.tempDom);
	}
	findElement(stringSelector, container) {
		const router = this;
		const view = router.view;
		const app = router.app;
		const modalsSelector = ".popup, .dialog, .popover, .actions-modal, .sheet-modal, .login-screen, .page";
		const $container = dom7_default(container);
		const selector = stringSelector;
		let found = $container.find(selector).filter((el) => dom7_default(el).parents(modalsSelector).length === 0);
		if (found.length > 1) {
			if (typeof view.selector === "string") found = $container.find(`${view.selector} ${selector}`);
			if (found.length > 1) found = $container.find(`.${app.params.viewMainClass} ${selector}`);
		}
		if (found.length === 1) return found;
		found = router.findElement(selector, $container);
		if (found && found.length === 1) return found;
		if (found && found.length > 1) return dom7_default(found[0]);
	}
	flattenRoutes(routes = this.routes) {
		const router = this;
		let flattenedRoutes = [];
		routes.forEach((route) => {
			let hasTabRoutes = false;
			if ("tabs" in route && route.tabs) {
				const mergedPathsRoutes = route.tabs.map((tabRoute) => {
					const tRoute = extend$1({}, route, {
						path: `${route.path}/${tabRoute.path}`.replace("///", "/").replace("//", "/"),
						parentPath: route.path,
						tab: tabRoute
					});
					delete tRoute.tabs;
					delete tRoute.routes;
					return tRoute;
				});
				hasTabRoutes = true;
				flattenedRoutes = flattenedRoutes.concat(router.flattenRoutes(mergedPathsRoutes));
			}
			if ("detailRoutes" in route) {
				const mergedPathsRoutes = route.detailRoutes.map((detailRoute) => {
					const dRoute = extend$1({}, detailRoute);
					dRoute.masterRoute = route;
					dRoute.masterRoutePath = route.path;
					return dRoute;
				});
				flattenedRoutes = flattenedRoutes.concat(route, router.flattenRoutes(mergedPathsRoutes));
			}
			if ("routes" in route) {
				const mergedPathsRoutes = route.routes.map((childRoute) => {
					const cRoute = extend$1({}, childRoute);
					cRoute.path = `${route.path}/${cRoute.path}`.replace("///", "/").replace("//", "/");
					return cRoute;
				});
				if (hasTabRoutes) flattenedRoutes = flattenedRoutes.concat(router.flattenRoutes(mergedPathsRoutes));
				else flattenedRoutes = flattenedRoutes.concat(route, router.flattenRoutes(mergedPathsRoutes));
			}
			if (!("routes" in route) && !("tabs" in route && route.tabs) && !("detailRoutes" in route)) flattenedRoutes.push(route);
		});
		return flattenedRoutes;
	}
	parseRouteUrl(url) {
		if (!url) return {};
		return {
			query: parseUrlQuery(url),
			hash: url.split("#")[1],
			params: {},
			url,
			path: url.split("#")[0].split("?")[0]
		};
	}
	generateUrl(parameters = {}) {
		if (typeof parameters === "string") return parameters;
		const { name, path, params, query } = parameters;
		if (!name && !path) throw new Error("Framework7: \"name\" or \"path\" parameter is required");
		const router = this;
		const route = name ? router.findRouteByKey("name", name) : router.findRouteByKey("path", path);
		if (!route) {
			if (name) throw new Error(`Framework7: route with name "${name}" not found`);
			else throw new Error(`Framework7: route with path "${path}" not found`);
		}
		const url = router.constructRouteUrl(route, {
			params,
			query
		});
		if (url === "") return "/";
		if (!url) throw new Error(`Framework7: can't construct URL for route with name "${name}"`);
		return url;
	}
	constructRouteUrl(route, { params, query } = {}) {
		const { path } = route;
		const toUrl = compile(path);
		let url;
		try {
			url = toUrl(params || {});
		} catch (error) {
			throw new Error(`Framework7: error constructing route URL from passed params:\nRoute: ${path}\n${error.toString()}`);
		}
		if (query) {
			if (typeof query === "string") url += `?${query}`;
			else if (Object.keys(query).length) url += `?${serializeObject(query)}`;
		}
		return url;
	}
	findTabRouteUrl(tabEl) {
		const router = this;
		const $tabEl = dom7_default(tabEl);
		const parentPath = router.currentRoute.route.parentPath;
		const tabId = $tabEl.attr("id");
		const flattenedRoutes = router.flattenRoutes(router.routes);
		let foundTabRouteUrl;
		flattenedRoutes.forEach((route) => {
			if (route.parentPath === parentPath && route.tab && route.tab.id === tabId) {
				if (router.currentRoute.params && Object.keys(router.currentRoute.params).length > 0) foundTabRouteUrl = router.constructRouteUrl(route, {
					params: router.currentRoute.params,
					query: router.currentRoute.query
				});
				else foundTabRouteUrl = route.path;
			}
		});
		return foundTabRouteUrl;
	}
	findRouteByKey(key, value) {
		const router = this;
		const routes = router.routes;
		const flattenedRoutes = router.flattenRoutes(routes);
		let matchingRoute;
		flattenedRoutes.forEach((route) => {
			if (matchingRoute) return;
			if (route[key] === value) matchingRoute = route;
		});
		return matchingRoute;
	}
	findMatchingRoute(url) {
		if (!url) return void 0;
		const router = this;
		const routes = router.routes;
		const flattenedRoutes = router.flattenRoutes(routes);
		const { path, query, hash, params } = router.parseRouteUrl(url);
		let matchingRoute;
		flattenedRoutes.forEach((route) => {
			if (matchingRoute) return;
			const keys = [];
			const pathsToMatch = [route.path || "/"];
			if (route.alias) {
				if (typeof route.alias === "string") pathsToMatch.push(route.alias);
				else if (Array.isArray(route.alias)) route.alias.forEach((aliasPath) => {
					pathsToMatch.push(aliasPath);
				});
			}
			let matched;
			pathsToMatch.forEach((pathToMatch) => {
				if (matched) return;
				matched = pathToRegexp(pathToMatch, keys).exec(path || "/");
			});
			if (matched) {
				keys.forEach((keyObj, index) => {
					if (typeof keyObj.name === "number") return;
					const paramValue = matched[index + 1];
					if (typeof paramValue === "undefined" || paramValue === null) params[keyObj.name] = paramValue;
					else params[keyObj.name] = decodeURIComponent(paramValue);
				});
				let parentPath;
				if (route.parentPath) parentPath = (path || "/").split("/").slice(0, route.parentPath.split("/").length - 1).join("/");
				matchingRoute = {
					query,
					hash,
					params,
					url,
					path: path || "/",
					parentPath,
					route,
					name: route.name
				};
			}
		});
		return matchingRoute;
	}
	replaceRequestUrlParams(url = "", options = {}) {
		let compiledUrl = url;
		if (typeof compiledUrl === "string" && compiledUrl.indexOf("{{") >= 0 && options && options.route && options.route.params && Object.keys(options.route.params).length) Object.keys(options.route.params).forEach((paramName) => {
			const regExp = new RegExp(`{{${paramName}}}`, "g");
			compiledUrl = compiledUrl.replace(regExp, options.route.params[paramName] || "");
		});
		return compiledUrl;
	}
	removeFromXhrCache(url) {
		const xhrCache = this.cache.xhr;
		let index = false;
		for (let i = 0; i < xhrCache.length; i += 1) if (xhrCache[i].url === url) index = i;
		if (index !== false) xhrCache.splice(index, 1);
	}
	xhrRequest(requestUrl, options) {
		const router = this;
		const params = router.params;
		const { ignoreCache } = options;
		let url = requestUrl;
		let hasQuery = url.indexOf("?") >= 0;
		if (params.passRouteQueryToRequest && options && options.route && options.route.query && Object.keys(options.route.query).length) {
			url += `${hasQuery ? "&" : "?"}${serializeObject(options.route.query)}`;
			hasQuery = true;
		}
		if (params.passRouteParamsToRequest && options && options.route && options.route.params && Object.keys(options.route.params).length) {
			url += `${hasQuery ? "&" : "?"}${serializeObject(options.route.params)}`;
			hasQuery = true;
		}
		if (url.indexOf("{{") >= 0) url = router.replaceRequestUrlParams(url, options);
		if (params.xhrCacheIgnoreGetParameters && url.indexOf("?") >= 0) url = url.split("?")[0];
		return new Promise((resolve, reject) => {
			if (params.xhrCache && !ignoreCache && url.indexOf("nocache") < 0 && params.xhrCacheIgnore.indexOf(url) < 0) for (let i = 0; i < router.cache.xhr.length; i += 1) {
				const cachedUrl = router.cache.xhr[i];
				if (cachedUrl.url === url) {
					if (now$1() - cachedUrl.time < params.xhrCacheDuration) {
						resolve(cachedUrl.content);
						return;
					}
				}
			}
			router.xhrAbortController = new AbortController();
			const fetchOptions = {
				method: "GET",
				signal: router.xhrAbortController.signal
			};
			router.emit("routerAjaxStart", options, fetchOptions);
			let fetchRes;
			fetch(url, fetchOptions).then((res) => {
				fetchRes = res;
				return res.text();
			}).then((responseText) => {
				const { status } = fetchRes;
				router.emit("routerAjaxComplete", fetchRes);
				if (status !== "error" && status !== "timeout" && status >= 200 && status < 300 || status === 0) {
					if (params.xhrCache && responseText !== "") {
						router.removeFromXhrCache(url);
						router.cache.xhr.push({
							url,
							time: now$1(),
							content: responseText
						});
					}
					router.emit("routerAjaxSuccess", fetchRes, options);
					resolve(responseText);
				} else {
					router.emit("routerAjaxError", fetchRes, options);
					reject(fetchRes);
				}
			}).catch((err) => {
				reject(err);
			});
		});
	}
	setPagePosition($el, position, ariaHidden) {
		const router = this;
		$el.removeClass("page-previous page-current page-next");
		$el.addClass(`page-${position}`);
		if (ariaHidden === false) $el.removeAttr("aria-hidden");
		else if (ariaHidden === true) $el.attr("aria-hidden", "true");
		$el.trigger("page:position", { position });
		router.emit("pagePosition", $el[0], position);
	}
	removeThemeElements(el) {
		const theme = this.app.theme;
		let toRemove;
		if (theme === "ios") toRemove = ".md-only, .if-md, .if-not-ios, .not-ios";
		else if (theme === "md") toRemove = ".ios-only, .if-ios, .if-not-md, .not-md";
		dom7_default(el).find(toRemove).remove();
	}
	getPageData(pageEl, from, to, route = {}, pageFromEl) {
		const router = this;
		const $pageEl = dom7_default(pageEl).eq(0);
		const currentPage = $pageEl[0].f7Page || {};
		let direction;
		let pageFrom;
		if (from === "next" && to === "current" || from === "current" && to === "previous") direction = "forward";
		if (from === "current" && to === "next" || from === "previous" && to === "current") direction = "backward";
		if (currentPage && !currentPage.fromPage) {
			const $pageFromEl = dom7_default(pageFromEl);
			if ($pageFromEl.length) pageFrom = $pageFromEl[0].f7Page;
		}
		pageFrom = currentPage.pageFrom || pageFrom;
		if (pageFrom && pageFrom.pageFrom) pageFrom.pageFrom = null;
		const page = {
			app: router.app,
			view: router.view,
			router,
			$el: $pageEl,
			el: $pageEl[0],
			$pageEl,
			pageEl: $pageEl[0],
			name: $pageEl.attr("data-name"),
			position: from,
			from,
			to,
			direction,
			route: currentPage.route ? currentPage.route : route,
			pageFrom
		};
		$pageEl[0].f7Page = page;
		return page;
	}
	pageCallback(callback, pageEl, from, to, options = {}, pageFromEl) {
		if (!pageEl) return;
		const router = this;
		const $pageEl = dom7_default(pageEl);
		if (!$pageEl.length) return;
		const { route } = options;
		const restoreScrollTopOnBack = router.params.restoreScrollTopOnBack && !(router.params.masterDetailBreakpoint > 0 && $pageEl.hasClass("page-master") && router.app.width >= router.params.masterDetailBreakpoint);
		const keepAlive = $pageEl[0].f7Page && $pageEl[0].f7Page.route && $pageEl[0].f7Page.route.route && $pageEl[0].f7Page.route.route.keepAlive;
		if (callback === "beforeRemove" && keepAlive) callback = "beforeUnmount";
		const camelName = `page${callback[0].toUpperCase() + callback.slice(1, callback.length)}`;
		const colonName = `page:${callback.toLowerCase()}`;
		let page = {};
		if (callback === "beforeRemove" && $pageEl[0].f7Page) page = extend$1($pageEl[0].f7Page, {
			from,
			to,
			position: from
		});
		else page = router.getPageData($pageEl[0], from, to, route, pageFromEl);
		page.swipeBack = !!options.swipeBack;
		const { on = {}, once = {} } = options.route ? options.route.route : {};
		if (options.on) extend$1(on, options.on);
		if (options.once) extend$1(once, options.once);
		function attachEvents() {
			if ($pageEl[0].f7RouteEventsAttached) return;
			$pageEl[0].f7RouteEventsAttached = true;
			if (on && Object.keys(on).length > 0) {
				$pageEl[0].f7RouteEventsOn = on;
				Object.keys(on).forEach((eventName) => {
					on[eventName] = on[eventName].bind(router);
					$pageEl.on(eventNameToColonCase(eventName), on[eventName]);
				});
			}
			if (once && Object.keys(once).length > 0) {
				$pageEl[0].f7RouteEventsOnce = once;
				Object.keys(once).forEach((eventName) => {
					once[eventName] = once[eventName].bind(router);
					$pageEl.once(eventNameToColonCase(eventName), once[eventName]);
				});
			}
		}
		function detachEvents() {
			if (!$pageEl[0].f7RouteEventsAttached) return;
			if ($pageEl[0].f7RouteEventsOn) Object.keys($pageEl[0].f7RouteEventsOn).forEach((eventName) => {
				$pageEl.off(eventNameToColonCase(eventName), $pageEl[0].f7RouteEventsOn[eventName]);
			});
			if ($pageEl[0].f7RouteEventsOnce) Object.keys($pageEl[0].f7RouteEventsOnce).forEach((eventName) => {
				$pageEl.off(eventNameToColonCase(eventName), $pageEl[0].f7RouteEventsOnce[eventName]);
			});
			$pageEl[0].f7RouteEventsAttached = null;
			$pageEl[0].f7RouteEventsOn = null;
			$pageEl[0].f7RouteEventsOnce = null;
			delete $pageEl[0].f7RouteEventsAttached;
			delete $pageEl[0].f7RouteEventsOn;
			delete $pageEl[0].f7RouteEventsOnce;
		}
		if (callback === "mounted") attachEvents();
		if (callback === "init") {
			if (restoreScrollTopOnBack && (from === "previous" || !from) && to === "current" && router.scrollHistory[page.route.url] && !$pageEl.hasClass("no-restore-scroll")) {
				let $pageContent = $pageEl.find(".page-content");
				if ($pageContent.length > 0) $pageContent = $pageContent.filter((pageContentEl) => {
					return dom7_default(pageContentEl).parents(".tab:not(.tab-active)").length === 0 && !dom7_default(pageContentEl).is(".tab:not(.tab-active)");
				});
				$pageContent.scrollTop(router.scrollHistory[page.route.url]);
			}
			attachEvents();
			if ($pageEl[0].f7PageInitialized) {
				$pageEl.trigger("page:reinit", page);
				router.emit("pageReinit", page);
				return;
			}
			$pageEl[0].f7PageInitialized = true;
		}
		if (restoreScrollTopOnBack && callback === "beforeOut" && from === "current" && to === "previous") {
			let $pageContent = $pageEl.find(".page-content");
			if ($pageContent.length > 0) $pageContent = $pageContent.filter((pageContentEl) => {
				return dom7_default(pageContentEl).parents(".tab:not(.tab-active)").length === 0 && !dom7_default(pageContentEl).is(".tab:not(.tab-active)");
			});
			router.scrollHistory[page.route.url] = $pageContent.scrollTop();
		}
		if (restoreScrollTopOnBack && callback === "beforeOut" && from === "current" && to === "next") delete router.scrollHistory[page.route.url];
		$pageEl.trigger(colonName, page);
		router.emit(camelName, page);
		if (callback === "beforeRemove" || callback === "beforeUnmount") {
			detachEvents();
			if (!keepAlive) $pageEl[0].f7Page = null;
		}
	}
	saveHistory() {
		const router = this;
		const window = getWindow();
		router.view.history = router.history;
		if (router.params.browserHistory && router.params.browserHistoryStoreHistory && window.localStorage) window.localStorage[`f7router-${router.view.id}-history`] = JSON.stringify(router.history);
	}
	restoreHistory() {
		const router = this;
		const window = getWindow();
		if (router.params.browserHistory && router.params.browserHistoryStoreHistory && window.localStorage && window.localStorage[`f7router-${router.view.id}-history`]) {
			router.history = JSON.parse(window.localStorage[`f7router-${router.view.id}-history`]);
			router.view.history = router.history;
		}
	}
	clearHistory() {
		const router = this;
		router.history = [];
		if (router.view) router.view.history = [];
		router.saveHistory();
	}
	updateCurrentUrl(newUrl) {
		const router = this;
		appRouterCheck(router, "updateCurrentUrl");
		if (router.history.length) router.history[router.history.length - 1] = newUrl;
		else router.history.push(newUrl);
		const { query, hash, params, url, path } = router.parseRouteUrl(newUrl);
		if (router.currentRoute) extend$1(router.currentRoute, {
			query,
			hash,
			params,
			url,
			path
		});
		if (router.params.browserHistory) {
			const browserHistoryRoot = router.params.browserHistoryRoot || "";
			History.replace(router.view.id, { url: newUrl }, browserHistoryRoot + router.params.browserHistorySeparator + newUrl);
		}
		router.saveHistory();
		router.emit("routeUrlUpdate", router.currentRoute, router);
	}
	getInitialUrl() {
		const router = this;
		if (router.initialUrl) return {
			initialUrl: router.initialUrl,
			historyRestored: router.historyRestored
		};
		const { app, view } = router;
		const document = getDocument();
		const window = getWindow();
		const location = app.params.url && typeof app.params.url === "string" && typeof URL !== "undefined" ? new URL(app.params.url) : document.location;
		let initialUrl = router.params.url;
		let documentUrl = location.href.split(location.origin)[1];
		let historyRestored;
		const { browserHistory, browserHistoryOnLoad, browserHistorySeparator } = router.params;
		let { browserHistoryRoot } = router.params;
		if ((window.cordova || window.Capacitor && (window.Capacitor.isNative || window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) && browserHistory && !browserHistorySeparator && !browserHistoryRoot && location.pathname.indexOf("index.html") >= 0) {
			console.warn("Framework7: wrong or not complete browserHistory configuration, trying to guess browserHistoryRoot");
			browserHistoryRoot = location.pathname.split("index.html")[0];
		}
		if (!browserHistory || !browserHistoryOnLoad) {
			if (!initialUrl) initialUrl = documentUrl;
			if (location.search && initialUrl.indexOf("?") < 0) initialUrl += location.search;
			if (location.hash && initialUrl.indexOf("#") < 0) initialUrl += location.hash;
		} else {
			if (browserHistoryRoot && documentUrl.indexOf(browserHistoryRoot) >= 0) {
				documentUrl = documentUrl.substring(documentUrl.indexOf(browserHistoryRoot) + browserHistoryRoot.length);
				if (documentUrl === "") documentUrl = "/";
			}
			if (browserHistorySeparator.length > 0 && documentUrl.indexOf(browserHistorySeparator) >= 0) initialUrl = documentUrl.substring(documentUrl.indexOf(browserHistorySeparator) + browserHistorySeparator.length);
			else initialUrl = documentUrl;
			router.restoreHistory();
			if (router.history.indexOf(initialUrl) >= 0) router.history = router.history.slice(0, router.history.indexOf(initialUrl) + 1);
			else if (router.params.url === initialUrl) router.history = [initialUrl];
			else if (History.state && History.state[view.id] && History.state[view.id].url === router.history[router.history.length - 1]) initialUrl = router.history[router.history.length - 1];
			else router.history = [documentUrl.split(browserHistorySeparator)[0] || "/", initialUrl];
			if (router.history.length > 1) historyRestored = true;
			else router.history = [];
			router.saveHistory();
		}
		router.initialUrl = initialUrl;
		router.historyRestored = historyRestored;
		return {
			initialUrl,
			historyRestored
		};
	}
	init() {
		const router = this;
		const { app, view } = router;
		router.mount();
		const { initialUrl, historyRestored } = router.getInitialUrl();
		if (view && router.params.iosSwipeBack && app.theme === "ios" || view && router.params.mdSwipeBack && app.theme === "md") SwipeBack(router);
		const { browserHistory, browserHistoryOnLoad, browserHistoryAnimateOnLoad, browserHistoryInitialMatch } = router.params;
		let currentRoute;
		if (router.history.length > 1) {
			const initUrl = browserHistoryInitialMatch ? initialUrl : router.history[0];
			currentRoute = router.findMatchingRoute(initUrl);
			if (!currentRoute) currentRoute = extend$1(router.parseRouteUrl(initUrl), { route: {
				url: initUrl,
				path: initUrl.split("?")[0]
			} });
		} else {
			currentRoute = router.findMatchingRoute(initialUrl);
			if (!currentRoute) currentRoute = extend$1(router.parseRouteUrl(initialUrl), { route: {
				url: initialUrl,
				path: initialUrl.split("?")[0]
			} });
		}
		if (router.$el.children(".page").length === 0 && initialUrl && router.params.loadInitialPage) router.navigate(initialUrl, {
			initial: true,
			reloadCurrent: true,
			browserHistory: false,
			animate: false,
			once: {
				modalOpen() {
					if (!historyRestored) return;
					if ((router.params.preloadPreviousPage || router.params[`${app.theme}SwipeBack`]) && router.history.length > 1) router.back({ preload: true });
				},
				pageAfterIn() {
					if (!historyRestored) return;
					if ((router.params.preloadPreviousPage || router.params[`${app.theme}SwipeBack`]) && router.history.length > 1) router.back({ preload: true });
				}
			}
		});
		else if (router.$el.children(".page").length) {
			let hasTabRoute;
			router.currentRoute = currentRoute;
			router.$el.children(".page").each((pageEl) => {
				const $pageEl = dom7_default(pageEl);
				router.setPagePosition($pageEl, "current");
				if (router.currentRoute && router.currentRoute.route && (router.currentRoute.route.master === true || typeof router.currentRoute.route.master === "function" && router.currentRoute.route.master(app, router)) && router.params.masterDetailBreakpoint > 0) {
					$pageEl.addClass("page-master");
					$pageEl.trigger("page:role", { role: "master" });
					view.checkMasterDetailBreakpoint();
				}
				const initOptions = { route: router.currentRoute };
				if (router.currentRoute && router.currentRoute.route && router.currentRoute.route.options) extend$1(initOptions, router.currentRoute.route.options);
				router.currentPageEl = $pageEl[0];
				router.removeThemeElements($pageEl);
				if (initOptions.route.route.tab) {
					hasTabRoute = true;
					router.tabLoad(initOptions.route.route.tab, extend$1({}, initOptions));
				}
				router.pageCallback("init", $pageEl, "current", void 0, initOptions);
				router.pageCallback("beforeIn", $pageEl, "current", void 0, initOptions);
				router.pageCallback("afterIn", $pageEl, "current", void 0, initOptions);
			});
			if (historyRestored) {
				if (browserHistoryInitialMatch) {
					if ((router.params.preloadPreviousPage || router.params[`${app.theme}SwipeBack`]) && router.history.length > 1) router.back({ preload: true });
				} else router.navigate(initialUrl, {
					initial: true,
					browserHistory: false,
					history: false,
					animate: browserHistoryAnimateOnLoad,
					once: { pageAfterIn() {
						if ((router.params.preloadPreviousPage || router.params[`${app.theme}SwipeBack`]) && router.history.length > 2) router.back({ preload: true });
					} }
				});
			}
			if (!historyRestored && !hasTabRoute) {
				router.history.push(initialUrl);
				router.saveHistory();
			}
		}
		if (initialUrl && browserHistory && browserHistoryOnLoad && (!History.state || !History.state[view.id])) History.initViewState(view.id, { url: initialUrl });
		router.emit("local::init routerInit", router);
	}
	destroy() {
		let router = this;
		router.emit("local::destroy routerDestroy", router);
		Object.keys(router).forEach((routerProp) => {
			router[routerProp] = null;
			delete router[routerProp];
		});
		router = null;
	}
};
Router.prototype.navigate = navigate;
Router.prototype.refreshPage = refreshPage;
Router.prototype.tabLoad = tabLoad;
Router.prototype.tabRemove = tabRemove;
Router.prototype.modalLoad = modalLoad;
Router.prototype.modalRemove = modalRemove;
Router.prototype.back = back;
Router.prototype.clearPreviousHistory = clearPreviousHistory;
var router_default = {
	name: "router",
	static: { Router },
	instance: { cache: {
		xhr: [],
		templates: [],
		components: []
	} },
	create() {
		const instance = this;
		if (instance.app) {
			if (instance.params.router) instance.router = new Router(instance.app, instance);
		} else instance.router = new Router(instance);
	}
};
function resizableView(view) {
	const app = view.app;
	if (view.resizableInitialized) return;
	extend$1(view, {
		resizable: true,
		resizableWidth: null,
		resizableInitialized: true
	});
	const $htmlEl = dom7_default("html");
	const { $el } = view;
	if (!$el) return;
	let $resizeHandlerEl;
	let isTouched;
	let isMoved;
	const touchesStart = {};
	let touchesDiff;
	let width;
	let minWidth;
	let maxWidth;
	function transformCSSWidth(v) {
		if (!v) return null;
		if (v.indexOf("%") >= 0 || v.indexOf("vw") >= 0) return parseInt(v, 10) / 100 * app.width;
		const newV = parseInt(v, 10);
		if (Number.isNaN(newV)) return null;
		return newV;
	}
	function isResizable() {
		return view.resizable && $el.hasClass("view-resizable") && $el.hasClass("view-master-detail");
	}
	function handleTouchStart(e) {
		if (!isResizable()) return;
		touchesStart.x = e.type === "touchstart" ? e.targetTouches[0].pageX : e.pageX;
		touchesStart.y = e.type === "touchstart" ? e.targetTouches[0].pageY : e.pageY;
		isMoved = false;
		isTouched = true;
		const $pageMasterEl = $el.children(".page-master");
		minWidth = transformCSSWidth($pageMasterEl.css("min-width"));
		maxWidth = transformCSSWidth($pageMasterEl.css("max-width"));
	}
	function handleTouchMove(e) {
		if (!isTouched) return;
		e.f7PreventSwipePanel = true;
		const pageX = e.type === "touchmove" ? e.targetTouches[0].pageX : e.pageX;
		if (!isMoved) {
			width = $resizeHandlerEl[0].offsetLeft + $resizeHandlerEl[0].offsetWidth;
			$el.addClass("view-resizing");
			$htmlEl.css("cursor", "col-resize");
		}
		isMoved = true;
		e.preventDefault();
		touchesDiff = pageX - touchesStart.x;
		let newWidth = width + touchesDiff;
		if (minWidth && !Number.isNaN(minWidth)) newWidth = Math.max(newWidth, minWidth);
		if (maxWidth && !Number.isNaN(maxWidth)) newWidth = Math.min(newWidth, maxWidth);
		newWidth = Math.min(Math.max(newWidth, 0), app.width);
		view.resizableWidth = newWidth;
		$htmlEl[0].style.setProperty("--f7-page-master-width", `${newWidth}px`);
		$el.trigger("view:resize", newWidth);
		view.emit("local::resize viewResize", view, newWidth);
	}
	function handleTouchEnd() {
		dom7_default("html").css("cursor", "");
		if (!isTouched || !isMoved) {
			isTouched = false;
			isMoved = false;
			return;
		}
		isTouched = false;
		isMoved = false;
		$htmlEl[0].style.setProperty("--f7-page-master-width", `${view.resizableWidth}px`);
		$el.removeClass("view-resizing");
	}
	function handleResize() {
		if (!view.resizableWidth) return;
		minWidth = transformCSSWidth($resizeHandlerEl.css("min-width"));
		maxWidth = transformCSSWidth($resizeHandlerEl.css("max-width"));
		if (minWidth && !Number.isNaN(minWidth) && view.resizableWidth < minWidth) view.resizableWidth = Math.max(view.resizableWidth, minWidth);
		if (maxWidth && !Number.isNaN(maxWidth) && view.resizableWidth > maxWidth) view.resizableWidth = Math.min(view.resizableWidth, maxWidth);
		view.resizableWidth = Math.min(Math.max(view.resizableWidth, 0), app.width);
		$htmlEl[0].style.setProperty("--f7-page-master-width", `${view.resizableWidth}px`);
	}
	$resizeHandlerEl = view.$el.children(".view-resize-handler");
	if (!$resizeHandlerEl.length) {
		view.$el.append("<div class=\"view-resize-handler\"></div>");
		$resizeHandlerEl = view.$el.children(".view-resize-handler");
	}
	view.$resizeHandlerEl = $resizeHandlerEl;
	$el.addClass("view-resizable");
	const passive = { passive: true };
	view.$el.on(app.touchEvents.start, ".view-resize-handler", handleTouchStart, passive);
	app.on("touchmove:active", handleTouchMove);
	app.on("touchend:passive", handleTouchEnd);
	app.on("resize", handleResize);
	view.on("beforeOpen", handleResize);
	view.once("viewDestroy", () => {
		$el.removeClass("view-resizable");
		view.$resizeHandlerEl.remove();
		view.$el.off(app.touchEvents.start, ".view-resize-handler", handleTouchStart, passive);
		app.off("touchmove:active", handleTouchMove);
		app.off("touchend:passive", handleTouchEnd);
		app.off("resize", handleResize);
		view.off("beforeOpen", handleResize);
	});
}
var View$1 = class extends Framework7Class {
	constructor(app, el, viewParams = {}) {
		super(viewParams, [app]);
		const view = this;
		const ssr = view.params.routerId;
		const defaults = {
			routes: [],
			routesAdd: []
		};
		if (!ssr) {
			if (!dom7_default(el).length) {
				let message = "Framework7: can't create a View instance because ";
				message += typeof el === "string" ? `the selector "${el}" didn't match any element` : "el must be an HTMLElement or Dom7 object";
				throw new Error(message);
			}
		}
		view.params = extend$1({ el }, defaults, app.params.view, viewParams);
		if (view.params.routes.length > 0) view.routes = view.params.routes;
		else view.routes = [].concat(app.routes, view.params.routesAdd);
		extend$1(false, view, {
			app,
			name: view.params.name,
			main: view.params.main,
			history: [],
			scrollHistory: {}
		});
		view.useModules();
		app.views.push(view);
		if (view.main) app.views.main = view;
		if (view.name) app.views[view.name] = view;
		view.index = app.views.indexOf(view);
		let viewId;
		if (view.name) viewId = `view_${view.name}`;
		else if (view.main) viewId = "view_main";
		else viewId = `view_${view.index}`;
		view.id = viewId;
		if (!view.params.init) return view;
		if (app.initialized) view.init();
		else app.on("init", () => {
			view.init();
		});
		return view;
	}
	destroy() {
		let view = this;
		const app = view.app;
		view.$el.trigger("view:beforedestroy");
		view.emit("local::beforeDestroy viewBeforeDestroy", view);
		app.off("resize", view.checkMasterDetailBreakpoint);
		if (view.main) {
			app.views.main = null;
			delete app.views.main;
		} else if (view.name) {
			app.views[view.name] = null;
			delete app.views[view.name];
		}
		view.$el[0].f7View = null;
		delete view.$el[0].f7View;
		app.views.splice(app.views.indexOf(view), 1);
		if (view.params.router && view.router) view.router.destroy();
		view.emit("local::destroy viewDestroy", view);
		Object.keys(view).forEach((viewProp) => {
			view[viewProp] = null;
			delete view[viewProp];
		});
		view = null;
	}
	checkMasterDetailBreakpoint(force) {
		const view = this;
		const app = view.app;
		const wasMasterDetail = view.$el.hasClass("view-master-detail");
		const isMasterDetail = app.width >= view.params.masterDetailBreakpoint && view.$el.children(".page-master").length;
		if (typeof force === "undefined" && isMasterDetail || force === true) {
			view.$el.addClass("view-master-detail");
			if (!wasMasterDetail) {
				view.emit("local::masterDetailBreakpoint viewMasterDetailBreakpoint", view);
				view.$el.trigger("view:masterDetailBreakpoint");
			}
		} else {
			view.$el.removeClass("view-master-detail");
			if (wasMasterDetail) {
				view.emit("local::masterDetailBreakpoint viewMasterDetailBreakpoint", view);
				view.$el.trigger("view:masterDetailBreakpoint");
			}
		}
	}
	initMasterDetail() {
		const view = this;
		const app = view.app;
		view.checkMasterDetailBreakpoint = view.checkMasterDetailBreakpoint.bind(view);
		view.checkMasterDetailBreakpoint();
		if (view.params.masterDetailResizable) resizableView(view);
		app.on("resize", view.checkMasterDetailBreakpoint);
	}
	mount(viewEl) {
		const view = this;
		const app = view.app;
		const el = view.params.el || viewEl;
		const $el = dom7_default(el);
		let selector;
		if (typeof el === "string") selector = el;
		else selector = ($el.attr("id") ? `#${$el.attr("id")}` : "") + ($el.attr("class") ? `.${$el.attr("class").replace(/ /g, ".").replace(".active", "")}` : "");
		extend$1(view, {
			$el,
			el: $el[0],
			main: view.main || $el.hasClass("view-main"),
			selector
		});
		if (view.main) app.views.main = view;
		if ($el && $el[0]) $el[0].f7View = view;
		view.emit("local::mount viewMount", view);
	}
	init(viewEl) {
		const view = this;
		view.mount(viewEl);
		if (view.params.router) {
			if (view.params.masterDetailBreakpoint > 0) view.initMasterDetail();
			if (view.params.initRouterOnTabShow && view.$el.hasClass("tab") && !view.$el.hasClass("tab-active")) view.$el.once("tab:show", () => {
				view.router.init();
			});
			else view.router.init();
			view.$el.trigger("view:init");
			view.emit("local::init viewInit", view);
		}
	}
};
View$1.use(router_default);
function initClicks(app) {
	function handleClicks(e) {
		const window = getWindow();
		const $clickedEl = dom7_default(e.target);
		const $clickedLinkEl = $clickedEl.closest("a");
		const isLink = $clickedLinkEl.length > 0;
		const url = isLink && $clickedLinkEl.attr("href");
		if ($clickedLinkEl.hasClass("disabled")) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		if (isLink) {
			if ($clickedLinkEl.is(app.params.clicks.externalLinks) || url && url.indexOf("javascript:") >= 0) {
				const target = $clickedLinkEl.attr("target");
				if (url && window.cordova && window.cordova.InAppBrowser && (target === "_system" || target === "_blank")) {
					e.preventDefault();
					window.cordova.InAppBrowser.open(url, target);
				} else if (url && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser && (target === "_system" || target === "_blank")) {
					e.preventDefault();
					window.Capacitor.Plugins.Browser.open({ url });
				}
				return;
			}
		}
		Object.keys(app.modules).forEach((moduleName) => {
			const moduleClicks = app.modules[moduleName].clicks;
			if (!moduleClicks) return;
			if (e.preventF7Router) return;
			Object.keys(moduleClicks).forEach((clickSelector) => {
				const matchingClickedElement = $clickedEl.closest(clickSelector).eq(0);
				if (matchingClickedElement.length > 0) moduleClicks[clickSelector].call(app, matchingClickedElement, matchingClickedElement.dataset(), e);
			});
		});
		let clickedLinkData = {};
		if (isLink) {
			e.preventDefault();
			clickedLinkData = $clickedLinkEl.dataset();
		}
		clickedLinkData.clickedEl = $clickedLinkEl[0];
		if (e.preventF7Router) return;
		if ($clickedLinkEl.hasClass("prevent-router") || $clickedLinkEl.hasClass("router-prevent")) return;
		if (url && url.length > 0 && url[0] !== "#" || $clickedLinkEl.hasClass("back")) {
			let view;
			if (clickedLinkData.view && clickedLinkData.view === "current") view = app.views.current;
			else if (clickedLinkData.view) view = dom7_default(clickedLinkData.view)[0].f7View;
			else {
				view = $clickedEl.parents(".view")[0] && $clickedEl.parents(".view")[0].f7View;
				if (view && view.params.linksView && (!$clickedLinkEl.hasClass("back") || $clickedLinkEl.hasClass("back") && view.router.history.length === 1)) {
					if (typeof view.params.linksView === "string") view = dom7_default(view.params.linksView)[0].f7View;
					else if (view.params.linksView instanceof View$1) view = view.params.linksView;
				}
			}
			if (!view) {
				if (app.views.main) view = app.views.main;
			}
			if (!view || !view.router) return;
			if ($clickedLinkEl[0].f7RouteProps) clickedLinkData.props = $clickedLinkEl[0].f7RouteProps;
			if ($clickedLinkEl.hasClass("back")) view.router.back(url, clickedLinkData);
			else view.router.navigate(url, clickedLinkData);
		}
	}
	app.on("click", handleClicks);
}
var clicks_default = {
	name: "clicks",
	params: { clicks: { externalLinks: ".external" } },
	on: { init() {
		initClicks(this);
	} }
};
var component_loader_default = {
	name: "routerComponentLoader",
	proto: {
		openIn(router, url, options) {
			const navigateOptions = {
				url,
				route: {
					path: url,
					options: {
						...options,
						openIn: void 0
					}
				}
			};
			const openInType = options.openIn.split(":")[0];
			const params = {
				...options,
				...options[`${openInType}Options`] || {}
			};
			delete params[`${openInType}Options`];
			const component = (props, ctx) => {
				const { $h, $onMounted, $el, $f7 } = ctx;
				$onMounted(() => {
					const viewEl = $el.value.find(".view");
					$f7.view.create(viewEl, {
						linksView: router.view.selector,
						ignoreOpenIn: true,
						loadInitialPage: false
					}).router.navigate(url, {
						props: options.props,
						reloadAll: true
					});
				});
				return () => {
					if (options.openIn === "popup") return $h`<div class="popup popup-router-open-in" data-url="${url}"><div class="view"></div></div>`;
					if (options.openIn === "loginScreen") return $h`<div class="login-screen login-screen-router-open-in" data-url="${url}"><div class="view"></div></div>`;
					if (options.openIn === "sheet") return $h`<div class="sheet-modal sheet-modal-router-open-in" data-url="${url}"><div class="sheet-modal-inner"><div class="view"></div></div></div>`;
					if (options.openIn === "popover") return $h`<div class="popover popover-router-open-in" data-url="${url}"><div class="popover-inner"><div class="view"></div></div></div>`;
					if (options.openIn.indexOf("panel") >= 0) {
						const parts = options.openIn.split(":");
						const side = parts[1] || "left";
						const effect = parts[2] || "cover";
						return $h`<div class="panel panel-router-open-in panel-${side} panel-${effect}" data-url="${url}"><div class="view"></div></div>`;
					}
				};
			};
			if (options.openIn === "popup") navigateOptions.route.popup = params;
			if (options.openIn === "loginScreen") navigateOptions.route.loginScreen = params;
			if (options.openIn === "sheet") navigateOptions.route.sheet = params;
			if (options.openIn === "popover") {
				params.targetEl = options.clickedEl || options.targetEl;
				navigateOptions.route.popover = params;
			}
			if (options.openIn.indexOf("panel") >= 0) {
				params.targetEl = options.clickedEl || options.targetEl;
				navigateOptions.route.panel = params;
			}
			params.component = component;
			return router.navigate(navigateOptions);
		},
		componentLoader(component, componentUrl, options = {}, resolve, reject) {
			const router = this;
			const { app } = router;
			const url = typeof component === "string" ? component : componentUrl;
			const compiledUrl = router.replaceRequestUrlParams(url, options);
			function compile(componentFunction) {
				let context = options.context || {};
				if (typeof context === "function") context = context.call(router);
				else if (typeof context === "string") try {
					context = JSON.parse(context);
				} catch (err) {
					reject(err);
					throw err;
				}
				const componentContext = merge({}, context, {
					f7route: options.route,
					f7router: router
				});
				const componentProps = merge(options.route ? options.route.params || {} : {}, options.props || {}, options.routeProps || {});
				let componentEl;
				let componentRoot;
				if (options.componentOptions && options.componentOptions.el) componentEl = options.componentOptions.el;
				if (options.componentOptions && options.componentOptions.root) componentRoot = options.componentOptions.root;
				app.component.create(componentFunction, componentProps, {
					context: componentContext,
					el: componentEl,
					root: componentRoot
				}).then((createdComponent) => {
					resolve(createdComponent.el);
				}).catch((err) => {
					reject(err);
					throw new Error(err, { cause: err });
				});
			}
			let cachedComponent;
			if (compiledUrl && router.params.componentCache) router.cache.components.forEach((cached) => {
				if (cached.url === compiledUrl) cachedComponent = cached.component;
			});
			if (compiledUrl && cachedComponent) compile(cachedComponent);
			else if (compiledUrl && !cachedComponent) {
				if (router.xhrAbortController) {
					router.xhrAbortController.abort();
					router.xhrAbortController = false;
				}
				router.xhrRequest(url, options).then((loadedComponent) => {
					const parsedComponent = app.component.parse(loadedComponent);
					if (router.params.componentCache) router.cache.components.push({
						url: compiledUrl,
						component: parsedComponent
					});
					compile(parsedComponent);
				}).catch((err) => {
					reject();
					throw err;
				});
			} else compile(component);
		},
		modalComponentLoader({ component, componentUrl, options, resolve, reject } = {}) {
			this.componentLoader(component, componentUrl, options, (el) => {
				resolve(el);
			}, reject);
		},
		tabComponentLoader({ component, componentUrl, options, resolve, reject } = {}) {
			this.componentLoader(component, componentUrl, options, (el) => {
				resolve(el);
			}, reject);
		},
		pageComponentLoader({ component, componentUrl, options, resolve, reject } = {}) {
			this.componentLoader(component, componentUrl, options, (el, newOptions = {}) => {
				resolve(el, newOptions);
			}, reject);
		}
	}
};
var n = function(t, s, r, e) {
	var u;
	s[0] = 0;
	for (var h = 1; h < s.length; h++) {
		var p = s[h++], a = s[h] ? (s[0] |= p ? 1 : 2, r[s[h++]]) : s[++h];
		3 === p ? e[0] = a : 4 === p ? e[1] = Object.assign(e[1] || {}, a) : 5 === p ? (e[1] = e[1] || {})[s[++h]] = a : 6 === p ? e[1][s[++h]] += a + "" : p ? (u = t.apply(a, n(t, a, r, ["", null])), e.push(u), a[0] ? s[0] |= 2 : (s[h - 2] = 0, s[h] = u)) : e.push(a);
	}
	return e;
};
var t = /* @__PURE__ */ new Map();
function htm_default(s) {
	var r = t.get(this);
	return r || (r = /* @__PURE__ */ new Map(), t.set(this, r)), (r = n(this, r.get(s) || (r.set(s, r = function(n) {
		for (var t, s, r = 1, e = "", u = "", h = [0], p = function(n) {
			1 === r && (n || (e = e.replace(/^\s*\n\s*|\s*\n\s*$/g, ""))) ? h.push(0, n, e) : 3 === r && (n || e) ? (h.push(3, n, e), r = 2) : 2 === r && "..." === e && n ? h.push(4, n, 0) : 2 === r && e && !n ? h.push(5, 0, !0, e) : r >= 5 && ((e || !n && 5 === r) && (h.push(r, 0, e, s), r = 6), n && (h.push(r, n, 0, s), r = 6)), e = "";
		}, a = 0; a < n.length; a++) {
			a && (1 === r && p(), p(a));
			for (var l = 0; l < n[a].length; l++) t = n[a][l], 1 === r ? "<" === t ? (p(), h = [h], r = 3) : e += t : 4 === r ? "--" === e && ">" === t ? (r = 1, e = "") : e = t + e[0] : u ? t === u ? u = "" : e += t : "\"" === t || "'" === t ? u = t : ">" === t ? (p(), r = 1) : r && ("=" === t ? (r = 5, s = e, e = "") : "/" === t && (r < 5 || ">" === n[a][l + 1]) ? (p(), 3 === r && (h = h[0]), r = h, (h = h[0]).push(2, 0, r), r = 0) : " " === t || "	" === t || "\n" === t || "\r" === t ? (p(), r = 2) : e += t), 3 === r && "!--" === e && (r = 4, h = h[0]);
		}
		return p(), h;
	}(s)), r), arguments, [])).length > 1 ? r : r[0];
}
var ignoreChildren$1 = [
	false,
	null,
	"",
	void 0
];
var h$1 = (type, props, ...children) => {
	return {
		type,
		props: props || {},
		children: flattenArray(children).filter((child) => ignoreChildren$1.indexOf(child) < 0)
	};
};
var $h = htm_default.bind(h$1);
function vnode(sel, data, children, text, elm) {
	return {
		sel,
		data,
		children,
		text,
		elm,
		key: data === void 0 ? void 0 : data.key
	};
}
var array = Array.isArray;
function primitive(s) {
	return typeof s === "string" || typeof s === "number";
}
function addNS(data, children, sel) {
	data.ns = "http://www.w3.org/2000/svg";
	if (sel !== "foreignObject" && children !== void 0) for (var i = 0; i < children.length; ++i) {
		var childData = children[i].data;
		if (childData !== void 0) addNS(childData, children[i].children, children[i].sel);
	}
}
function h(sel, b, c) {
	var data = {}, children, text, i;
	if (c !== void 0) {
		data = b;
		if (array(c)) children = c;
		else if (primitive(c)) text = c;
		else if (c && c.sel) children = [c];
	} else if (b !== void 0) {
		if (array(b)) children = b;
		else if (primitive(b)) text = b;
		else if (b && b.sel) children = [b];
		else data = b;
	}
	if (array(children)) {
		for (i = 0; i < children.length; ++i) if (primitive(children[i])) children[i] = vnode(void 0, void 0, void 0, children[i], void 0);
	}
	if (sel[0] === "s" && sel[1] === "v" && sel[2] === "g" && (sel.length === 3 || sel[3] === "." || sel[3] === "#")) addNS(data, children, sel);
	return vnode(sel, data, children, text, void 0);
}
var custom_components_default = {};
var SELF_CLOSING = "area base br col command embed hr img input keygen link menuitem meta param source track wbr".split(" ");
var PROPS_ATTRS = "hidden checked disabled readonly selected autofocus autoplay required multiple value indeterminate routeProps innerHTML".split(" ");
var BOOLEAN_PROPS = "hidden checked disabled readonly selected autofocus autoplay required multiple readOnly indeterminate".split(" ");
var getTagName = (treeNode) => {
	return typeof treeNode.type === "function" ? treeNode.type.name || "CustomComponent" : treeNode.type;
};
var toCamelCase = (name) => {
	return name.split("-").map((word, index) => {
		if (index === 0) return word.toLowerCase();
		return word[0].toUpperCase() + word.substr(1);
	}).join("");
};
var propsFromAttrs = (...args) => {
	const context = {};
	args.forEach((obj = {}) => {
		Object.keys(obj).forEach((key) => {
			context[toCamelCase(key)] = obj[key];
		});
	});
	return context;
};
var createCustomComponent = ({ f7, treeNode, vnode, data }) => {
	const component = typeof treeNode.type === "function" ? treeNode.type : custom_components_default[treeNode.type];
	f7.component.create(component, propsFromAttrs(data.attrs || {}, data.props || {}), {
		el: vnode.elm,
		children: treeNode.children
	}).then((c) => {
		if (vnode.data && vnode.data.on && c && c.$el) Object.keys(vnode.data.on).forEach((eventName) => {
			c.$el.on(eventName, vnode.data.on[eventName]);
		});
		vnode.elm.__component__ = c;
	});
};
var updateCustomComponent = (vnode) => {
	const component = vnode && vnode.elm && vnode.elm.__component__;
	if (!component) return;
	const newProps = propsFromAttrs(vnode.data.attrs || {}, vnode.data.props || {});
	component.children = vnode.data.treeNode.children;
	Object.assign(component.props, newProps);
	component.update();
};
var destroyCustomComponent = (vnode) => {
	const component = vnode && vnode.elm && vnode.elm.__component__;
	if (component) {
		const { el, $el } = component;
		if (vnode.data && vnode.data.on && $el) Object.keys(vnode.data.on).forEach((eventName) => {
			$el.off(eventName, vnode.data.on[eventName]);
		});
		if (component.destroy) component.destroy();
		if (el && el.parentNode) el.parentNode.removeChild(el);
		delete vnode.elm.__component__;
	}
};
var isCustomComponent = (treeNodeType) => {
	return typeof treeNodeType === "function" || treeNodeType && treeNodeType.indexOf("-") > 0 && custom_components_default[treeNodeType];
};
function getHooks(treeNode, data, f7, initial, isRoot) {
	const hooks = {};
	const insert = [];
	const destroy = [];
	const update = [];
	const postpatch = [];
	let isFakeElement = false;
	let tagName = getTagName(treeNode);
	if (data && data.attrs && data.attrs.component) {
		tagName = data.attrs.component;
		delete data.attrs.component;
		isFakeElement = true;
	}
	const isCustom = isCustomComponent(treeNode.type);
	if (isCustom) {
		insert.push((vnode) => {
			if (vnode.sel !== tagName && !isFakeElement) return;
			createCustomComponent({
				f7,
				treeNode,
				vnode,
				data
			});
		});
		destroy.push((vnode) => {
			destroyCustomComponent(vnode);
		});
		update.push((oldVnode, vnode) => {
			updateCustomComponent(vnode);
		});
	}
	if (!isCustom) {
		if (!data || !data.attrs || !data.attrs.class) return hooks;
		data.attrs.class.split(" ").forEach((className) => {
			if (!initial) insert.push(...f7.getVnodeHooks("insert", className));
			destroy.push(...f7.getVnodeHooks("destroy", className));
			update.push(...f7.getVnodeHooks("update", className));
			postpatch.push(...f7.getVnodeHooks("postpatch", className));
		});
	}
	if (isRoot && !initial) postpatch.push((oldVnode, vnode) => {
		const vn = vnode || oldVnode;
		if (!vn) return;
		if (vn.data && vn.data.component) vn.data.component.hook("onUpdated");
	});
	if (insert.length === 0 && destroy.length === 0 && update.length === 0 && postpatch.length === 0) return hooks;
	if (insert.length) hooks.insert = (vnode) => {
		insert.forEach((f) => f(vnode));
	};
	if (destroy.length) hooks.destroy = (vnode) => {
		destroy.forEach((f) => f(vnode));
	};
	if (update.length) hooks.update = (oldVnode, vnode) => {
		update.forEach((f) => f(oldVnode, vnode));
	};
	if (postpatch.length) hooks.postpatch = (oldVnode, vnode) => {
		postpatch.forEach((f) => f(oldVnode, vnode));
	};
	return hooks;
}
var getEventHandler = (eventHandler, { stop, prevent, once } = {}) => {
	let fired = false;
	function handler(...args) {
		const e = args[0];
		if (once && fired) return;
		if (stop) e.stopPropagation();
		if (prevent) e.preventDefault();
		fired = true;
		eventHandler(...args);
	}
	return handler;
};
var getData = (treeNode, component, f7, initial, isRoot) => {
	const data = {
		component,
		treeNode
	};
	const tagName = getTagName(treeNode);
	Object.keys(treeNode.props).forEach((attrName) => {
		const attrValue = treeNode.props[attrName];
		if (typeof attrValue === "undefined") return;
		if (PROPS_ATTRS.indexOf(attrName) >= 0) {
			if (!data.props) data.props = {};
			if (attrName === "readonly") attrName = "readOnly";
			if (attrName === "routeProps") attrName = "f7RouteProps";
			if (tagName === "option" && attrName === "value") {
				if (!data.attrs) data.attrs = {};
				data.attrs.value = attrValue;
			}
			if (BOOLEAN_PROPS.indexOf(attrName) >= 0) data.props[attrName] = attrValue === false ? false : true;
			else data.props[attrName] = attrValue;
		} else if (attrName === "key") data.key = attrValue;
		else if (attrName.indexOf("@") === 0 || attrName.indexOf("on") === 0 && attrName.length > 2) {
			if (!data.on) data.on = {};
			let eventName = attrName.indexOf("@") === 0 ? attrName.substr(1) : eventNameToColonCase(attrName.substr(2));
			let stop = false;
			let prevent = false;
			let once = false;
			if (eventName.indexOf(".") >= 0) eventName.split(".").forEach((eventNamePart, eventNameIndex) => {
				if (eventNameIndex === 0) eventName = eventNamePart;
				else {
					if (eventNamePart === "stop") stop = true;
					if (eventNamePart === "prevent") prevent = true;
					if (eventNamePart === "once") once = true;
				}
			});
			data.on[eventName] = getEventHandler(attrValue, {
				stop,
				prevent,
				once
			});
		} else if (attrName === "style") {
			if (typeof attrValue !== "string") data.style = attrValue;
			else {
				if (!data.attrs) data.attrs = {};
				data.attrs.style = attrValue;
			}
		} else {
			if (!data.attrs) data.attrs = {};
			data.attrs[attrName] = attrValue;
			if (attrName === "id" && !data.key && !isRoot) data.key = attrValue;
		}
	});
	const hooks = getHooks(treeNode, data, f7, initial, isRoot);
	hooks.prepatch = (oldVnode, vnode) => {
		if (!oldVnode || !vnode) return;
		if (oldVnode && oldVnode.data && oldVnode.data.props) Object.keys(oldVnode.data.props).forEach((key) => {
			if (BOOLEAN_PROPS.indexOf(key) < 0) return;
			if (!vnode.data) vnode.data = {};
			if (!vnode.data.props) vnode.data.props = {};
			if (oldVnode.data.props[key] === true && !(key in vnode.data.props)) vnode.data.props[key] = false;
		});
	};
	data.hook = hooks;
	return data;
};
var getChildren = (treeNode, component, f7, initial) => {
	if (treeNode && treeNode.type && SELF_CLOSING.indexOf(treeNode.type) >= 0) return [];
	const children = [];
	const nodes = treeNode.children;
	for (let i = 0; i < nodes.length; i += 1) {
		const childNode = nodes[i];
		const child = treeNodeToVNode(childNode, component, f7, initial, false);
		if (Array.isArray(child)) children.push(...child);
		else if (child) children.push(child);
	}
	return children;
};
var getSlots = (treeNode, component, f7, initial) => {
	const slotName = treeNode.props.name || "default";
	const slotNodes = (component.children || []).filter((childTreeNode) => {
		let childSlotName = "default";
		if (childTreeNode.props) childSlotName = childTreeNode.props.slot || "default";
		return childSlotName === slotName;
	});
	if (slotNodes.length === 0) return getChildren(treeNode, component, f7, initial);
	return slotNodes.map((subTreeNode) => treeNodeToVNode(subTreeNode, component, f7, initial));
};
var isTreeNode = (treeNode) => {
	return isObject$1(treeNode) && "props" in treeNode && "type" in treeNode && "children" in treeNode;
};
var treeNodeToVNode = (treeNode, component, f7, initial, isRoot) => {
	if (!isTreeNode(treeNode)) return String(treeNode);
	if (treeNode.type === "slot") return getSlots(treeNode, component, f7, initial);
	const data = getData(treeNode, component, f7, initial, isRoot);
	const children = isCustomComponent(treeNode.type) ? [] : getChildren(treeNode, component, f7, initial);
	return h(getTagName(treeNode), data, children);
};
function vdom(tree = {}, component, initial) {
	return treeNodeToVNode(tree, component, component.f7, initial, true);
}
function createElement(tagName) {
	return document.createElement(tagName);
}
function createElementNS(namespaceURI, qualifiedName) {
	return document.createElementNS(namespaceURI, qualifiedName);
}
function createTextNode(text) {
	return document.createTextNode(text);
}
function createComment(text) {
	return document.createComment(text);
}
function insertBefore(parentNode, newNode, referenceNode) {
	if (referenceNode && referenceNode.parentNode !== parentNode) {
		if (referenceNode.__component__) referenceNode = referenceNode.__component__.el;
	}
	parentNode.insertBefore(newNode, referenceNode);
}
function removeChild(node, child) {
	if (!node) return;
	node.removeChild(child);
}
function appendChild(node, child) {
	node.appendChild(child);
}
function parentNode(node) {
	return node.parentNode;
}
function nextSibling(node) {
	return node.nextSibling;
}
function tagName(elm) {
	return elm.tagName;
}
function setTextContent(node, text) {
	node.textContent = text;
}
function getTextContent(node) {
	return node.textContent;
}
function isElement(node) {
	return node.nodeType === 1;
}
function isText(node) {
	return node.nodeType === 3;
}
function isComment(node) {
	return node.nodeType === 8;
}
var htmlDomApi = {
	createElement,
	createElementNS,
	createTextNode,
	createComment,
	insertBefore,
	removeChild,
	appendChild,
	parentNode,
	nextSibling,
	tagName,
	setTextContent,
	getTextContent,
	isElement,
	isText,
	isComment
};
function isUndef(s) {
	return s === void 0;
}
function isDef(s) {
	return s !== void 0;
}
var emptyNode = vnode("", {}, [], void 0, void 0);
function sameVnode(vnode1, vnode2) {
	return vnode1.key === vnode2.key && vnode1.sel === vnode2.sel;
}
function isVnode(vnode) {
	return vnode.sel !== void 0;
}
function createKeyToOldIdx(children, beginIdx, endIdx) {
	var i, map = {}, key, ch;
	for (i = beginIdx; i <= endIdx; ++i) {
		ch = children[i];
		if (ch != null) {
			key = ch.key;
			if (key !== void 0) map[key] = i;
		}
	}
	return map;
}
var hooks = [
	"create",
	"update",
	"remove",
	"destroy",
	"pre",
	"post"
];
function init(modules, domApi) {
	var i, j, cbs = {};
	var api = domApi !== void 0 ? domApi : htmlDomApi;
	for (i = 0; i < hooks.length; ++i) {
		cbs[hooks[i]] = [];
		for (j = 0; j < modules.length; ++j) {
			var hook = modules[j][hooks[i]];
			if (hook !== void 0) cbs[hooks[i]].push(hook);
		}
	}
	function emptyNodeAt(elm) {
		var id = elm.id ? "#" + elm.id : "";
		var c = elm.className ? "." + elm.className.split(" ").join(".") : "";
		return vnode(api.tagName(elm).toLowerCase() + id + c, {}, [], void 0, elm);
	}
	function createRmCb(childElm, listeners) {
		return function rmCb() {
			if (--listeners === 0) {
				var parent_1 = api.parentNode(childElm);
				api.removeChild(parent_1, childElm);
			}
		};
	}
	function createElm(vnode, insertedVnodeQueue) {
		var i, data = vnode.data;
		if (data !== void 0) {
			if (isDef(i = data.hook) && isDef(i = i.init)) {
				i(vnode);
				data = vnode.data;
			}
		}
		var children = vnode.children, sel = vnode.sel;
		if (sel === "!") {
			if (isUndef(vnode.text)) vnode.text = "";
			vnode.elm = api.createComment(vnode.text);
		} else if (sel !== void 0) {
			var hashIdx = sel.indexOf("#");
			var dotIdx = sel.indexOf(".", hashIdx);
			var hash = hashIdx > 0 ? hashIdx : sel.length;
			var dot = dotIdx > 0 ? dotIdx : sel.length;
			var tag = hashIdx !== -1 || dotIdx !== -1 ? sel.slice(0, Math.min(hash, dot)) : sel;
			var elm = vnode.elm = isDef(data) && isDef(i = data.ns) ? api.createElementNS(i, tag) : api.createElement(tag);
			if (hash < dot) elm.setAttribute("id", sel.slice(hash + 1, dot));
			if (dotIdx > 0) elm.setAttribute("class", sel.slice(dot + 1).replace(/\./g, " "));
			for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);
			if (array(children)) for (i = 0; i < children.length; ++i) {
				var ch = children[i];
				if (ch != null) api.appendChild(elm, createElm(ch, insertedVnodeQueue));
			}
			else if (primitive(vnode.text)) api.appendChild(elm, api.createTextNode(vnode.text));
			i = vnode.data.hook;
			if (isDef(i)) {
				if (i.create) i.create(emptyNode, vnode);
				if (i.insert) insertedVnodeQueue.push(vnode);
			}
		} else vnode.elm = api.createTextNode(vnode.text);
		return vnode.elm;
	}
	function addVnodes(parentElm, before, vnodes, startIdx, endIdx, insertedVnodeQueue) {
		for (; startIdx <= endIdx; ++startIdx) {
			var ch = vnodes[startIdx];
			if (ch != null) api.insertBefore(parentElm, createElm(ch, insertedVnodeQueue), before);
		}
	}
	function invokeDestroyHook(vnode) {
		var i, j, data = vnode.data;
		if (data !== void 0) {
			if (isDef(i = data.hook) && isDef(i = i.destroy)) i(vnode);
			for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
			if (vnode.children !== void 0) for (j = 0; j < vnode.children.length; ++j) {
				i = vnode.children[j];
				if (i != null && typeof i !== "string") invokeDestroyHook(i);
			}
		}
	}
	function removeVnodes(parentElm, vnodes, startIdx, endIdx) {
		for (; startIdx <= endIdx; ++startIdx) {
			var i_1 = void 0, listeners = void 0, rm = void 0, ch = vnodes[startIdx];
			if (ch != null) {
				if (isDef(ch.sel)) {
					invokeDestroyHook(ch);
					listeners = cbs.remove.length + 1;
					rm = createRmCb(ch.elm, listeners);
					for (i_1 = 0; i_1 < cbs.remove.length; ++i_1) cbs.remove[i_1](ch, rm);
					if (isDef(i_1 = ch.data) && isDef(i_1 = i_1.hook) && isDef(i_1 = i_1.remove)) i_1(ch, rm);
					else rm();
				} else api.removeChild(parentElm, ch.elm);
			}
		}
	}
	function updateChildren(parentElm, oldCh, newCh, insertedVnodeQueue) {
		var oldStartIdx = 0, newStartIdx = 0;
		var oldEndIdx = oldCh.length - 1;
		var oldStartVnode = oldCh[0];
		var oldEndVnode = oldCh[oldEndIdx];
		var newEndIdx = newCh.length - 1;
		var newStartVnode = newCh[0];
		var newEndVnode = newCh[newEndIdx];
		var oldKeyToIdx;
		var idxInOld;
		var elmToMove;
		var before;
		while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) if (oldStartVnode == null) oldStartVnode = oldCh[++oldStartIdx];
		else if (oldEndVnode == null) oldEndVnode = oldCh[--oldEndIdx];
		else if (newStartVnode == null) newStartVnode = newCh[++newStartIdx];
		else if (newEndVnode == null) newEndVnode = newCh[--newEndIdx];
		else if (sameVnode(oldStartVnode, newStartVnode)) {
			patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue);
			oldStartVnode = oldCh[++oldStartIdx];
			newStartVnode = newCh[++newStartIdx];
		} else if (sameVnode(oldEndVnode, newEndVnode)) {
			patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue);
			oldEndVnode = oldCh[--oldEndIdx];
			newEndVnode = newCh[--newEndIdx];
		} else if (sameVnode(oldStartVnode, newEndVnode)) {
			patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue);
			api.insertBefore(parentElm, oldStartVnode.elm, api.nextSibling(oldEndVnode.elm));
			oldStartVnode = oldCh[++oldStartIdx];
			newEndVnode = newCh[--newEndIdx];
		} else if (sameVnode(oldEndVnode, newStartVnode)) {
			patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
			api.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm);
			oldEndVnode = oldCh[--oldEndIdx];
			newStartVnode = newCh[++newStartIdx];
		} else {
			if (oldKeyToIdx === void 0) oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
			idxInOld = oldKeyToIdx[newStartVnode.key];
			if (isUndef(idxInOld)) {
				api.insertBefore(parentElm, createElm(newStartVnode, insertedVnodeQueue), oldStartVnode.elm);
				newStartVnode = newCh[++newStartIdx];
			} else {
				elmToMove = oldCh[idxInOld];
				if (elmToMove.sel !== newStartVnode.sel) api.insertBefore(parentElm, createElm(newStartVnode, insertedVnodeQueue), oldStartVnode.elm);
				else {
					patchVnode(elmToMove, newStartVnode, insertedVnodeQueue);
					oldCh[idxInOld] = void 0;
					api.insertBefore(parentElm, elmToMove.elm, oldStartVnode.elm);
				}
				newStartVnode = newCh[++newStartIdx];
			}
		}
		if (oldStartIdx <= oldEndIdx || newStartIdx <= newEndIdx) {
			if (oldStartIdx > oldEndIdx) {
				before = newCh[newEndIdx + 1] == null ? null : newCh[newEndIdx + 1].elm;
				addVnodes(parentElm, before, newCh, newStartIdx, newEndIdx, insertedVnodeQueue);
			} else removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx);
		}
	}
	function patchVnode(oldVnode, vnode, insertedVnodeQueue) {
		var i, hook;
		if (isDef(i = vnode.data) && isDef(hook = i.hook) && isDef(i = hook.prepatch)) i(oldVnode, vnode);
		var elm = vnode.elm = oldVnode.elm;
		var oldCh = oldVnode.children;
		var ch = vnode.children;
		if (oldVnode === vnode) return;
		if (vnode.data !== void 0) {
			for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode);
			i = vnode.data.hook;
			if (isDef(i) && isDef(i = i.update)) i(oldVnode, vnode);
		}
		if (isUndef(vnode.text)) {
			if (isDef(oldCh) && isDef(ch)) {
				if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue);
			} else if (isDef(ch)) {
				if (isDef(oldVnode.text)) api.setTextContent(elm, "");
				addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);
			} else if (isDef(oldCh)) removeVnodes(elm, oldCh, 0, oldCh.length - 1);
			else if (isDef(oldVnode.text)) api.setTextContent(elm, "");
		} else if (oldVnode.text !== vnode.text) api.setTextContent(elm, vnode.text);
		if (isDef(hook) && isDef(i = hook.postpatch)) i(oldVnode, vnode);
	}
	return function patch(oldVnode, vnode) {
		var i, elm, parent;
		var insertedVnodeQueue = [];
		for (i = 0; i < cbs.pre.length; ++i) cbs.pre[i]();
		if (!isVnode(oldVnode)) oldVnode = emptyNodeAt(oldVnode);
		if (sameVnode(oldVnode, vnode)) patchVnode(oldVnode, vnode, insertedVnodeQueue);
		else {
			elm = oldVnode.elm;
			parent = api.parentNode(elm);
			createElm(vnode, insertedVnodeQueue);
			if (parent !== null) {
				api.insertBefore(parent, vnode.elm, api.nextSibling(elm));
				removeVnodes(parent, [oldVnode], 0, 0);
			}
		}
		for (i = 0; i < insertedVnodeQueue.length; ++i) insertedVnodeQueue[i].data.hook.insert(insertedVnodeQueue[i]);
		for (i = 0; i < cbs.post.length; ++i) cbs.post[i]();
		return vnode;
	};
}
var xlinkNS = "http://www.w3.org/1999/xlink";
var xmlNS = "http://www.w3.org/XML/1998/namespace";
var colonChar = 58;
var xChar = 120;
function updateAttrs(oldVnode, vnode) {
	var key, elm = vnode.elm, oldAttrs = oldVnode.data.attrs, attrs = vnode.data.attrs;
	if (!oldAttrs && !attrs) return;
	if (oldAttrs === attrs) return;
	oldAttrs = oldAttrs || {};
	attrs = attrs || {};
	for (key in attrs) {
		var cur = attrs[key];
		if (oldAttrs[key] !== cur) {
			if (cur === true) elm.setAttribute(key, "");
			else if (cur === false) elm.removeAttribute(key);
			else if (key.charCodeAt(0) !== xChar) elm.setAttribute(key, cur);
			else if (key.charCodeAt(3) === colonChar) elm.setAttributeNS(xmlNS, key, cur);
			else if (key.charCodeAt(5) === colonChar) elm.setAttributeNS(xlinkNS, key, cur);
			else elm.setAttribute(key, cur);
		}
	}
	for (key in oldAttrs) if (!(key in attrs)) elm.removeAttribute(key);
}
var attributesModule = {
	create: updateAttrs,
	update: updateAttrs
};
function updateProps(oldVnode, vnode) {
	var key, cur, old, elm = vnode.elm, oldProps = oldVnode.data.props, props = vnode.data.props;
	if (!oldProps && !props) return;
	if (oldProps === props) return;
	oldProps = oldProps || {};
	props = props || {};
	for (key in oldProps) if (!props[key]) delete elm[key];
	for (key in props) {
		cur = props[key];
		old = oldProps[key];
		if (old !== cur && (key !== "value" || elm[key] !== cur)) elm[key] = cur;
	}
}
var propsModule = {
	create: updateProps,
	update: updateProps
};
var raf = typeof window !== "undefined" && window.requestAnimationFrame || setTimeout;
var nextFrame = function(fn) {
	raf(function() {
		raf(fn);
	});
};
function setNextFrame(obj, prop, val) {
	nextFrame(function() {
		obj[prop] = val;
	});
}
function updateStyle(oldVnode, vnode) {
	var cur, name, elm = vnode.elm, oldStyle = oldVnode.data.style, style = vnode.data.style;
	if (!oldStyle && !style) return;
	if (oldStyle === style) return;
	oldStyle = oldStyle || {};
	style = style || {};
	var oldHasDel = "delayed" in oldStyle;
	for (name in oldStyle) if (!style[name]) {
		if (name[0] === "-" && name[1] === "-") elm.style.removeProperty(name);
		else elm.style[name] = "";
	}
	for (name in style) {
		cur = style[name];
		if (name === "delayed" && style.delayed) for (var name2 in style.delayed) {
			cur = style.delayed[name2];
			if (!oldHasDel || cur !== oldStyle.delayed[name2]) setNextFrame(elm.style, name2, cur);
		}
		else if (name !== "remove" && cur !== oldStyle[name]) {
			if (name[0] === "-" && name[1] === "-") elm.style.setProperty(name, cur);
			else elm.style[name] = cur;
		}
	}
}
function applyDestroyStyle(vnode) {
	var style, name, elm = vnode.elm, s = vnode.data.style;
	if (!s || !(style = s.destroy)) return;
	for (name in style) elm.style[name] = style[name];
}
function applyRemoveStyle(vnode, rm) {
	var s = vnode.data.style;
	if (!s || !s.remove) {
		rm();
		return;
	}
	var name, elm = vnode.elm, i = 0, compStyle, style = s.remove, amount = 0, applied = [];
	for (name in style) {
		applied.push(name);
		elm.style[name] = style[name];
	}
	compStyle = getComputedStyle(elm);
	var props = compStyle["transition-property"].split(", ");
	for (; i < props.length; ++i) if (applied.indexOf(props[i]) !== -1) amount++;
	elm.addEventListener("transitionend", function(ev) {
		if (ev.target === elm) --amount;
		if (amount === 0) rm();
	});
}
var styleModule = {
	create: updateStyle,
	update: updateStyle,
	destroy: applyDestroyStyle,
	remove: applyRemoveStyle
};
function invokeHandler(handler, event, args) {
	if (typeof handler === "function") handler(event, ...args);
}
function handleEvent(event, args, vnode) {
	const name = event.type;
	const on = vnode.data.on;
	if (on && on[name]) invokeHandler(on[name], event, args, vnode);
}
function createListener() {
	return function handler(event, ...args) {
		handleEvent(event, args, handler.vnode);
	};
}
function updateEvents(oldVnode, vnode) {
	const oldOn = oldVnode.data.on;
	const oldListener = oldVnode.listener;
	const oldElm = oldVnode.elm;
	const on = vnode && vnode.data.on;
	const elm = vnode && vnode.elm;
	if (oldOn === on) return;
	if (oldOn && oldListener) {
		if (!on) Object.keys(oldOn).forEach((name) => {
			dom7_default(oldElm).off(name, oldListener);
		});
		else Object.keys(oldOn).forEach((name) => {
			if (!on[name]) dom7_default(oldElm).off(name, oldListener);
		});
	}
	if (on) {
		const listener = oldVnode.listener || createListener();
		vnode.listener = listener;
		listener.vnode = vnode;
		if (!oldOn) Object.keys(on).forEach((name) => {
			dom7_default(elm).on(name, listener);
		});
		else Object.keys(on).forEach((name) => {
			if (!oldOn[name]) dom7_default(elm).on(name, listener);
		});
	}
}
var patch = init([
	attributesModule,
	propsModule,
	styleModule,
	{
		create: updateEvents,
		update: updateEvents,
		destroy: updateEvents
	}
]);
var ignoreChildren = [
	false,
	null,
	"",
	void 0
];
var $jsx = (type, props, ...children) => {
	const flatChildren = flattenArray(children || []).filter((child) => ignoreChildren.indexOf(child) < 0);
	if (type === "Fragment") return flatChildren;
	return {
		type,
		props: props || {},
		children: flatChildren
	};
};
var types = [
	{
		name: "array",
		init: (i) => i,
		type: (i) => [i].find(Array.isArray),
		update: (i, o) => [o].filter(Array.isArray).find(() => (i.length = 0, i.push(...o))),
		insert: (i, x, o = []) => i.splice(Math.max(x, 0), 0, ...[o].flat()),
		replace: (i, x, o = []) => i.splice(Math.max(x, 0), Math.min(++x, 1), ...[o].flat()),
		append: (i, o = []) => i.push(...[o].flat()),
		prepend: (i, o = []) => i.unshift(...[o].flat()),
		swap: (i, a, b) => {
			[i[a], i[b]] = [i[b], i[a]];
		},
		fromTo: (i, a, b = a) => i.splice(Math.max(b, 0), 0, ...i.splice(Math.max(a, 0), 1)),
		remove: (i, o, a = i.map((_, x) => x)) => [o].flat().filter((i) => a.includes(i)).sort((a, b) => b - a).forEach((x) => i.splice(x, 1)),
		clear: (i) => i.length = 0
	},
	{
		name: "object",
		init: (i) => i,
		type: (i) => [i].filter((i) => [i !== null, i !== void 0].every((i) => i)).find((i) => Object.getPrototypeOf(i) === Object.prototype),
		update: (i, o) => Object.assign(i, o),
		insert: () => {},
		replace: () => {},
		append: () => {},
		prepend: () => {},
		swap: () => ({}),
		fromTo: () => ({}),
		remove: (i, o) => [o].flat().forEach((k) => delete i[k]),
		clear: (i) => Object.keys(i).forEach((k) => delete i[k])
	},
	{
		name: "atoms",
		type: () => true,
		init: (i, o = {}) => (Object.defineProperty(o, "value", {
			get: () => i,
			set: (v) => {
				i = v;
			}
		}), o),
		update: (i, v = i.value) => {
			i.value = v;
		},
		insert: () => ({}),
		replace: () => ({}),
		append: () => ({}),
		prepend: () => ({}),
		swap: () => ({}),
		fromTo: () => ({}),
		remove: () => ({}),
		clear: (i) => {
			i.value = void 0;
		}
	}
];
var Component = class {
	constructor(app, component, props = {}, { el, context, children } = {}) {
		const document = getDocument();
		merge(this, {
			f7: app,
			props: props || {},
			context: context || {},
			id: component.id || id(),
			children: children || [],
			theme: {
				ios: app.theme === "ios",
				md: app.theme === "md"
			},
			style: component.style,
			__updateQueue: [],
			__eventHandlers: [],
			__onceEventHandlers: [],
			__onBeforeMount: [],
			__onMounted: [],
			__onBeforeUpdate: [],
			__onUpdated: [],
			__onBeforeUnmount: [],
			__onUnmounted: []
		});
		const createComponent = () => {
			return component(this.props, this.getComponentContext(true));
		};
		const getRenderFuncion = (componentResult) => new Promise((resolve, reject) => {
			if (typeof componentResult === "function") resolve(componentResult);
			else if (componentResult instanceof Promise) componentResult.then((render) => {
				resolve(render);
			}).catch((err) => {
				reject(err);
			});
			else reject(/* @__PURE__ */ new Error("Framework7: Component render function is not a \"function\" type. Didn't you forget to \"return $render\"?"));
		});
		return new Promise((resolve, reject) => {
			const componentResult = createComponent();
			getRenderFuncion(componentResult).then((render) => {
				this.renderFunction = render;
				const tree = this.render();
				if (el) {
					this.vnode = vdom(tree, this, true);
					if (this.style) {
						this.styleEl = document.createElement("style");
						this.styleEl.innerHTML = this.style;
					}
					this.el = el;
					patch(this.el, this.vnode);
					this.el = this.vnode.elm;
					this.$el = dom7_default(this.el);
					this.attachEvents();
					this.el.f7Component = this;
					this.mount();
					resolve(this);
					return;
				}
				if (tree) {
					this.vnode = vdom(tree, this, true);
					this.el = document.createElement(this.vnode.sel || "div");
					patch(this.el, this.vnode);
					this.$el = dom7_default(this.el);
				}
				if (this.style) {
					this.styleEl = document.createElement("style");
					this.styleEl.innerHTML = this.style;
				}
				this.attachEvents();
				if (this.el) this.el.f7Component = this;
				resolve(this);
			}).catch((err) => {
				reject(err);
			});
		});
	}
	on(eventName, handler) {
		if (!this.__eventHandlers) return;
		this.__eventHandlers.push({
			eventName,
			handler
		});
	}
	once(eventName, handler) {
		if (!this.__eventHandlers) return;
		this.__onceEventHandlers.push({
			eventName,
			handler
		});
	}
	getComponentRef() {
		const self = this;
		return (initialValue) => {
			let value = initialValue;
			const obj = {};
			Object.defineProperty(obj, "value", {
				get() {
					return value;
				},
				set(v) {
					value = v;
					self.update();
				}
			});
			return obj;
		};
	}
	getComponentStore() {
		const { state, _gettersPlain, dispatch } = this.f7.store;
		const $store = {
			state,
			dispatch
		};
		$store.getters = new Proxy(_gettersPlain, { get: (target, prop) => {
			const obj = target[prop];
			const callback = (v) => {
				obj.value = v;
				this.update();
			};
			obj.onUpdated(callback);
			return obj;
		} });
		return $store;
	}
	getUseState() {
		return (o) => {
			const obj = [o].reduce((t, _i, _x, _a, i = t.init(_i)) => ({
				state: i,
				update: (v) => (t.update(i, v), this.update()),
				remove: (v) => (t.remove(i, v), this.update()),
				clear: () => (t.clear(i), this.update()),
				insert: (x, v) => (t.insert(i, x, v), this.update()),
				replace: (x, v) => (t.replace(i, x, v), this.update()),
				append: (v) => (t.append(i, v), this.update()),
				prepend: (v) => (t.prepend(i, v), this.update()),
				swap: (a, b) => (t.swap(i, a, b), this.update()),
				fromTo: (a, b) => (t.fromTo(i, a, b), this.update()),
				method: (f = () => ({})) => (f(i), this.update()),
				async: (f = () => Promise.reject(i)) => f(i).then(() => this.update())
			}), types.find((i) => i.type(o)));
			obj.length = 12;
			obj[Symbol.iterator] = function Iterate() {
				const values = Object.values(this);
				values.splice(values.indexOf(12), 1);
				let index = 0;
				return { next() {
					if (index < values.length) {
						const val = values[index];
						index += 1;
						return {
							value: val,
							done: false
						};
					}
					return { done: true };
				} };
			};
			return obj;
		};
	}
	getComponentContext(includeHooks) {
		const ctx = {
			$f7route: this.context.f7route,
			$f7router: this.context.f7router,
			$h,
			$: dom7_default,
			$id: this.id,
			$f7: this.f7,
			$f7ready: this.f7ready.bind(this),
			$theme: this.theme,
			$tick: this.tick.bind(this),
			$update: this.update.bind(this),
			$emit: this.emit.bind(this),
			$store: this.getComponentStore(),
			$ref: this.getComponentRef(),
			$el: {},
			$useState: this.getUseState()
		};
		Object.defineProperty(ctx.$el, "value", { get: () => {
			return this.$el;
		} });
		if (includeHooks) Object.assign(ctx, {
			$on: this.on.bind(this),
			$once: this.once.bind(this),
			$onBeforeMount: (handler) => this.__onBeforeMount.push(handler),
			$onMounted: (handler) => this.__onMounted.push(handler),
			$onBeforeUpdate: (handler) => this.__onBeforeUpdate.push(handler),
			$onUpdated: (handler) => this.__onUpdated.push(handler),
			$onBeforeUnmount: (handler) => this.__onBeforeUnmount.push(handler),
			$onUnmounted: (handler) => this.__onUnmounted.push(handler)
		});
		return ctx;
	}
	render() {
		return this.renderFunction(this.getComponentContext());
	}
	emit(name, data) {
		if (!this.el) return;
		this.$el.trigger(name, data);
	}
	attachEvents() {
		const { $el } = this;
		if (!this.__eventHandlers) return;
		this.__eventHandlers.forEach(({ eventName, handler }) => {
			$el.on(eventNameToColonCase(eventName), handler);
		});
		this.__onceEventHandlers.forEach(({ eventName, handler }) => {
			$el.once(eventNameToColonCase(eventName), handler);
		});
	}
	detachEvents() {
		const { $el } = this;
		if (!this.__eventHandlers) return;
		this.__eventHandlers.forEach(({ eventName, handler }) => {
			$el.on(eventNameToColonCase(eventName), handler);
		});
		this.__onceEventHandlers.forEach(({ eventName, handler }) => {
			$el.once(eventNameToColonCase(eventName), handler);
		});
	}
	startUpdateQueue() {
		const window = getWindow();
		if (this.__requestAnimationFrameId) return;
		const update = () => {
			this.hook("onBeforeUpdate");
			const tree = this.render();
			if (tree) {
				const newVNode = vdom(tree, this, false);
				this.vnode = patch(this.vnode, newVNode);
			}
		};
		this.__requestAnimationFrameId = window.requestAnimationFrame(() => {
			if (this.__updateIsPending) update();
			let resolvers = [...this.__updateQueue];
			this.__updateQueue = [];
			this.__updateIsPending = false;
			window.cancelAnimationFrame(this.__requestAnimationFrameId);
			delete this.__requestAnimationFrameId;
			delete this.__updateIsPending;
			resolvers.forEach((resolver) => resolver());
			resolvers = [];
		});
	}
	tick(callback) {
		return new Promise((resolve) => {
			function resolver() {
				resolve();
				if (callback) callback();
			}
			this.__updateQueue.push(resolver);
			this.startUpdateQueue();
		});
	}
	update(callback) {
		if (this.__destroyed) return new Promise(() => {});
		return new Promise((resolve) => {
			const resolver = () => {
				resolve();
				if (callback) callback();
			};
			this.__updateIsPending = true;
			this.__updateQueue.push(resolver);
			this.startUpdateQueue();
		});
	}
	setState(callback) {
		return this.update(callback);
	}
	f7ready(callback) {
		if (this.f7.initialized) {
			callback(this.f7);
			return;
		}
		this.f7.once("init", () => {
			callback(this.f7);
		});
	}
	mount(mountMethod) {
		this.hook("onBeforeMount", this.$el);
		if (this.styleEl) dom7_default("head").append(this.styleEl);
		if (mountMethod) mountMethod(this.el);
		this.hook("onMounted", this.$el);
	}
	destroy() {
		if (this.__destroyed) return;
		const window = getWindow();
		this.hook("onBeforeUnmount");
		if (this.styleEl) dom7_default(this.styleEl).remove();
		this.detachEvents();
		this.hook("onUnmounted");
		if (this.el && this.el.f7Component) {
			this.el.f7Component = null;
			delete this.el.f7Component;
		}
		if (this.vnode) this.vnode = patch(this.vnode, {
			sel: this.vnode.sel,
			data: {}
		});
		window.cancelAnimationFrame(this.__requestAnimationFrameId);
		this.__updateQueue = [];
		this.__eventHandlers = [];
		this.__onceEventHandlers = [];
		this.__onBeforeMount = [];
		this.__onMounted = [];
		this.__onBeforeUpdate = [];
		this.__onUpdated = [];
		this.__onBeforeUnmount = [];
		this.__onUnmounted = [];
		deleteProps(this);
		this.__destroyed = true;
	}
	hook(name, ...args) {
		if (this.__destroyed) return;
		this[`__${name}`].forEach((handler) => {
			handler(...args);
		});
	}
};
Component.$jsx = $jsx;
function parseComponent(componentString) {
	const window = getWindow();
	const document = getDocument();
	const componentId = id();
	const callbackCreateName = `f7_component_create_callback_${componentId}`;
	let template;
	if (componentString.match(/<template([ ]?)([a-z0-9-]*)>/)) template = componentString.split(/<template[ ]?[a-z0-9-]*>/).filter((item, index) => index > 0).join("<template>").split("</template>").filter((item, index, arr) => index < arr.length - 1).join("</template>").replace(/{{#raw}}([ \n]*)<template/g, "{{#raw}}<template").replace(/\/template>([ \n]*){{\/raw}}/g, "/template>{{/raw}}").replace(/([ \n])<template/g, "$1{{#raw}}<template").replace(/\/template>([ \n])/g, "/template>{{/raw}}$1");
	let style = null;
	if (componentString.indexOf("<style>") >= 0) style = componentString.split("<style>")[1].split("</style>")[0];
	if (componentString.indexOf("<style scoped>") >= 0) style = componentString.split("<style scoped>")[1].split("</style>")[0];
	let scriptContent;
	if (componentString.indexOf("<script>") >= 0) {
		const scripts = componentString.split("<script>");
		scriptContent = scripts[scripts.length - 1].split("<\/script>")[0].trim();
	} else scriptContent = "return () => {return $render}";
	if (!scriptContent || !scriptContent.trim()) scriptContent = "return () => {return $render}";
	if (template) scriptContent = scriptContent.replace("$render", `function ($$ctx) {
          var $ = $$ctx.$$;
          var $h = $$ctx.$h;
          var $root = $$ctx.$root;
          var $f7 = $$ctx.$f7;
          var $f7route = $$ctx.$f7route;
          var $f7router = $$ctx.$f7router;
          var $theme = $$ctx.$theme;
          var $update = $$ctx.$update;
          var $store = $$ctx.$store;
          var $ref = $$ctx.$ref;
          var $useState = $$ctx.$useState;

          return $h\`${template}\`
        }
        `).replace(/export default/g, "return");
	scriptContent = `window.${callbackCreateName} = function () {${scriptContent}}`;
	const scriptEl = document.createElement("script");
	scriptEl.innerHTML = scriptContent;
	dom7_default("head").append(scriptEl);
	const component = window[callbackCreateName]();
	dom7_default(scriptEl).remove();
	window[callbackCreateName] = null;
	delete window[callbackCreateName];
	if (style) component.style = style;
	component.id = componentId;
	return component;
}
function registerComponent(tagName, component) {
	custom_components_default[tagName] = component;
}
function unregisterComponent(tagName) {
	delete custom_components_default[tagName];
}
var component_default = {
	name: "component",
	static: {
		Component,
		parseComponent,
		registerComponent,
		unregisterComponent
	},
	create() {
		const app = this;
		app.component = {
			registerComponent,
			unregisterComponent,
			parse(componentString) {
				return parseComponent(componentString);
			},
			create(component, props, { root, el, context, children }) {
				return new Component(app, component, props, {
					root,
					el,
					context,
					children
				});
			}
		};
	}
};
var history_default = {
	name: "history",
	static: { history: History },
	on: { init() {
		History.init(this);
	} }
};
var SW = {
	registrations: [],
	register(path, scope) {
		const app = this;
		if (!("serviceWorker" in getWindow().navigator) || !app.serviceWorker.container) return new Promise((resolve, reject) => {
			reject(/* @__PURE__ */ new Error("Service worker is not supported"));
		});
		return new Promise((resolve, reject) => {
			app.serviceWorker.container.register(path, scope ? { scope } : {}).then((reg) => {
				SW.registrations.push(reg);
				app.emit("serviceWorkerRegisterSuccess", reg);
				resolve(reg);
			}).catch((error) => {
				app.emit("serviceWorkerRegisterError", error);
				reject(error);
			});
		});
	},
	unregister(registration) {
		const app = this;
		if (!("serviceWorker" in getWindow().navigator) || !app.serviceWorker.container) return new Promise((resolve, reject) => {
			reject(/* @__PURE__ */ new Error("Service worker is not supported"));
		});
		let registrations;
		if (!registration) registrations = SW.registrations;
		else if (Array.isArray(registration)) registrations = registration;
		else registrations = [registration];
		return Promise.all(registrations.map((reg) => new Promise((resolve, reject) => {
			reg.unregister().then(() => {
				if (SW.registrations.indexOf(reg) >= 0) SW.registrations.splice(SW.registrations.indexOf(reg), 1);
				app.emit("serviceWorkerUnregisterSuccess", reg);
				resolve();
			}).catch((error) => {
				app.emit("serviceWorkerUnregisterError", reg, error);
				reject(error);
			});
		})));
	}
};
var service_worker_default = {
	name: "sw",
	params: { serviceWorker: {
		path: void 0,
		scope: void 0
	} },
	create() {
		const app = this;
		const window = getWindow();
		extend$1(app, { serviceWorker: {
			container: "serviceWorker" in window.navigator ? window.navigator.serviceWorker : void 0,
			registrations: SW.registrations,
			register: SW.register.bind(app),
			unregister: SW.unregister.bind(app)
		} });
	},
	on: { init() {
		const window = getWindow();
		if (!("serviceWorker" in window.navigator)) return;
		const app = this;
		if (app.device.cordova || window.Capacitor && (window.Capacitor.isNative || window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
		if (!app.serviceWorker.container) return;
		const paths = app.params.serviceWorker.path;
		const scope = app.params.serviceWorker.scope;
		if (!paths || Array.isArray(paths) && !paths.length) return;
		(Array.isArray(paths) ? paths : [paths]).forEach((path) => {
			app.serviceWorker.register(path, scope);
		});
	} }
};
function createStore(storeParams = {}) {
	const store = { __store: true };
	const originalState = { ...storeParams.state || {} };
	const actions = { ...storeParams.actions || {} };
	const getters = { ...storeParams.getters || {} };
	const state = extend$1({}, originalState);
	let propsQueue = [];
	const gettersDependencies = {};
	const gettersCallbacks = {};
	Object.keys(getters).forEach((getterKey) => {
		gettersDependencies[getterKey] = [];
		gettersCallbacks[getterKey] = [];
	});
	const getGetterValue = (getterKey) => {
		return getters[getterKey]({ state: store.state });
	};
	const addGetterDependencies = (getterKey, deps) => {
		if (!gettersDependencies[getterKey]) gettersDependencies[getterKey] = [];
		deps.forEach((dep) => {
			if (gettersDependencies[getterKey].indexOf(dep) < 0) gettersDependencies[getterKey].push(dep);
		});
	};
	const addGetterCallback = (getterKey, callback) => {
		if (!gettersCallbacks[getterKey]) gettersCallbacks[getterKey] = [];
		gettersCallbacks[getterKey].push(callback);
	};
	const runGetterCallbacks = (stateKey) => {
		Object.keys(gettersDependencies).filter((getterKey) => {
			return gettersDependencies[getterKey].indexOf(stateKey) >= 0;
		}).forEach((getterKey) => {
			if (!gettersCallbacks[getterKey] || !gettersCallbacks[getterKey].length) return;
			gettersCallbacks[getterKey].forEach((callback) => {
				callback(getGetterValue(getterKey));
			});
		});
	};
	const removeGetterCallback = (callback) => {
		Object.keys(gettersCallbacks).forEach((stateKey) => {
			const callbacks = gettersCallbacks[stateKey];
			if (callbacks.indexOf(callback) >= 0) callbacks.splice(callbacks.indexOf(callback), 1);
		});
	};
	store.__removeCallback = (callback) => {
		removeGetterCallback(callback);
	};
	const getterValue = (getterKey, addCallback = true) => {
		if (getterKey === "constructor") return void 0;
		propsQueue = [];
		const value = getGetterValue(getterKey);
		addGetterDependencies(getterKey, propsQueue);
		const onUpdated = (callback) => {
			addGetterCallback(getterKey, callback);
		};
		const obj = {
			value,
			onUpdated
		};
		if (!addCallback) return obj;
		const callback = (v) => {
			obj.value = v;
		};
		obj.__callback = callback;
		addGetterCallback(getterKey, callback);
		return obj;
	};
	store.state = new Proxy(state, {
		set: (target, prop, value) => {
			target[prop] = value;
			runGetterCallbacks(prop);
			return true;
		},
		get: (target, prop) => {
			propsQueue.push(prop);
			return target[prop];
		}
	});
	store.getters = new Proxy(getters, {
		set: () => false,
		get: (target, prop) => {
			if (!target[prop]) return;
			return getterValue(prop, true);
		}
	});
	store._gettersPlain = new Proxy(getters, {
		set: () => false,
		get: (target, prop) => {
			if (!target[prop]) return;
			return getterValue(prop, false);
		}
	});
	store.dispatch = (actionName, data) => {
		return new Promise((resolve, reject) => {
			if (!actions[actionName]) {
				reject();
				throw new Error(`Framework7: Store action "${actionName}" is not found`);
			}
			resolve(actions[actionName]({
				state: store.state,
				dispatch: store.dispatch
			}, data));
		});
	};
	return store;
}
var store_default = {
	name: "store",
	static: { createStore },
	proto: { createStore }
};
var isCapacitor = () => {
	const window = getWindow();
	return window.Capacitor && (window.Capacitor.isNative || window.Capacitor.isNativePlatform) && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
};
var Statusbar = {
	hide() {
		const window = getWindow();
		if (getDevice().cordova && window.StatusBar) window.StatusBar.hide();
		if (isCapacitor()) window.Capacitor.Plugins.StatusBar.hide();
	},
	show() {
		const window = getWindow();
		if (getDevice().cordova && window.StatusBar) window.StatusBar.show();
		if (isCapacitor()) window.Capacitor.Plugins.StatusBar.show();
	},
	onClick() {
		const app = this;
		let pageContent;
		if (dom7_default(".popup.modal-in").length > 0) pageContent = dom7_default(".popup.modal-in").find(".page:not(.page-previous):not(.page-next):not(.cached)").find(".page-content");
		else if (dom7_default(".panel.panel-in").length > 0) pageContent = dom7_default(".panel.panel-in").find(".page:not(.page-previous):not(.page-next):not(.cached)").find(".page-content");
		else if (dom7_default(".views > .view.tab-active").length > 0) pageContent = dom7_default(".views > .view.tab-active").find(".page:not(.page-previous):not(.page-next):not(.cached)").find(".page-content");
		else if (dom7_default(".views").length > 0) pageContent = dom7_default(".views").find(".page:not(.page-previous):not(.page-next):not(.cached)").find(".page-content");
		else pageContent = app.$el.children(".view").find(".page:not(.page-previous):not(.page-next):not(.cached)").find(".page-content");
		if (pageContent && pageContent.length > 0) {
			if (pageContent.hasClass("tab")) pageContent = pageContent.parent(".tabs").children(".page-content.tab-active");
			if (pageContent.length > 0) pageContent.scrollTop(0, 300);
		}
	},
	setTextColor(color) {
		const window = getWindow();
		if (getDevice().cordova && window.StatusBar) {
			if (color === "white") window.StatusBar.styleLightContent();
			else window.StatusBar.styleDefault();
		}
		if (isCapacitor()) {
			if (color === "white") window.Capacitor.Plugins.StatusBar.setStyle({ style: "DARK" });
			else window.Capacitor.Plugins.StatusBar.setStyle({ style: "LIGHT" });
		}
	},
	setBackgroundColor(color) {
		const window = getWindow();
		if (getDevice().cordova && window.StatusBar) window.StatusBar.backgroundColorByHexString(color);
		if (isCapacitor()) window.Capacitor.Plugins.StatusBar.setBackgroundColor({ color });
	},
	isVisible() {
		const window = getWindow();
		const device = getDevice();
		return new Promise((resolve) => {
			if (device.cordova && window.StatusBar) resolve(window.StatusBar.isVisible);
			if (isCapacitor()) window.Capacitor.Plugins.StatusBar.getInfo().then((info) => {
				resolve(info.visible);
			});
			resolve(false);
		});
	},
	overlaysWebView(overlays = true) {
		const window = getWindow();
		if (getDevice().cordova && window.StatusBar) window.StatusBar.overlaysWebView(overlays);
		if (isCapacitor()) window.Capacitor.Plugins.StatusBar.setOverlaysWebView({ overlay: overlays });
	},
	init() {
		const app = this;
		const window = getWindow();
		const device = getDevice();
		const params = app.params.statusbar;
		if (!params.enabled) return;
		const isCordova = device.cordova && window.StatusBar;
		const isCap = isCapacitor();
		if (isCordova || isCap) {
			if (params.scrollTopOnClick) dom7_default(window).on("statusTap", Statusbar.onClick.bind(app));
			if (device.ios) {
				if (params.iosOverlaysWebView) Statusbar.overlaysWebView(true);
				else Statusbar.overlaysWebView(false);
				if (params.iosTextColor === "white") Statusbar.setTextColor("white");
				else Statusbar.setTextColor("black");
			}
			if (device.android) {
				if (params.androidOverlaysWebView) Statusbar.overlaysWebView(true);
				else Statusbar.overlaysWebView(false);
				if (params.androidTextColor === "white") Statusbar.setTextColor("white");
				else Statusbar.setTextColor("black");
			}
		}
		if (params.iosBackgroundColor && device.ios) Statusbar.setBackgroundColor(params.iosBackgroundColor);
		if (params.androidBackgroundColor && device.android) Statusbar.setBackgroundColor(params.androidBackgroundColor);
	}
};
var statusbar_default = {
	name: "statusbar",
	params: { statusbar: {
		enabled: true,
		scrollTopOnClick: true,
		iosOverlaysWebView: true,
		iosTextColor: "black",
		iosBackgroundColor: null,
		androidOverlaysWebView: false,
		androidTextColor: "black",
		androidBackgroundColor: null
	} },
	create() {
		bindMethods(this, { statusbar: Statusbar });
	},
	on: { init() {
		const app = this;
		Statusbar.init.call(app);
	} }
};
function getCurrentView(app) {
	const $popoverView = dom7_default(".popover.modal-in .view");
	const $popupView = dom7_default(".popup.modal-in .view");
	const $panelView = dom7_default(".panel.panel-in .view");
	let $viewsEl = dom7_default(".views");
	if ($viewsEl.length === 0) $viewsEl = app.$el;
	let $viewEl = $viewsEl.children(".view");
	if ($viewEl.length === 0) $viewEl = $viewsEl.children(".tabs").children(".view");
	if ($viewEl.length > 1) {
		if ($viewEl.hasClass("tab")) {
			$viewEl = $viewsEl.children(".view.tab-active");
			if ($viewEl.length === 0) $viewEl = $viewsEl.children(".tabs").children(".view.tab-active");
		}
	}
	if ($popoverView.length > 0 && $popoverView[0].f7View) return $popoverView[0].f7View;
	if ($popupView.length > 0 && $popupView[0].f7View) return $popupView[0].f7View;
	if ($panelView.length > 0 && $panelView[0].f7View) return $panelView[0].f7View;
	if ($viewEl.length > 0) {
		if ($viewEl.length === 1 && $viewEl[0].f7View) return $viewEl[0].f7View;
		if ($viewEl.length > 1) return app.views.main;
	}
}
var view_default = {
	name: "view",
	params: { view: {
		init: true,
		initRouterOnTabShow: false,
		name: void 0,
		main: false,
		router: true,
		linksView: null,
		xhrCache: true,
		xhrCacheIgnore: [],
		xhrCacheIgnoreGetParameters: false,
		xhrCacheDuration: 6e5,
		componentCache: true,
		preloadPreviousPage: true,
		allowDuplicateUrls: false,
		reloadPages: false,
		reloadDetail: false,
		masterDetailBreakpoint: 0,
		masterDetailResizable: false,
		removeElements: true,
		removeElementsWithTimeout: false,
		removeElementsTimeout: 0,
		restoreScrollTopOnBack: true,
		unloadTabContent: true,
		passRouteQueryToRequest: true,
		passRouteParamsToRequest: false,
		loadInitialPage: true,
		iosSwipeBack: true,
		iosSwipeBackAnimateShadow: true,
		iosSwipeBackAnimateOpacity: true,
		iosSwipeBackActiveArea: 30,
		iosSwipeBackThreshold: 0,
		mdSwipeBack: false,
		mdSwipeBackAnimateShadow: true,
		mdSwipeBackAnimateOpacity: true,
		mdSwipeBackActiveArea: 30,
		mdSwipeBackThreshold: 0,
		browserHistory: false,
		browserHistoryRoot: void 0,
		browserHistoryAnimate: true,
		browserHistoryAnimateOnLoad: false,
		browserHistorySeparator: "#!",
		browserHistoryOnLoad: true,
		browserHistoryInitialMatch: false,
		browserHistoryStoreHistory: true,
		browserHistoryTabs: "replace",
		animate: true,
		iosPageLoadDelay: 0,
		mdPageLoadDelay: 0,
		routesBeforeEnter: null,
		routesBeforeLeave: null
	} },
	static: { View: View$1 },
	create() {
		const app = this;
		extend$1(app, { views: extend$1([], {
			create(el, params) {
				return new View$1(app, el, params);
			},
			get(viewEl) {
				const $viewEl = dom7_default(viewEl);
				if ($viewEl.length && $viewEl[0].f7View) return $viewEl[0].f7View;
			}
		}) });
		Object.defineProperty(app.views, "current", {
			enumerable: true,
			configurable: true,
			get() {
				return getCurrentView(app);
			}
		});
		app.view = app.views;
	},
	on: {
		init() {
			const app = this;
			dom7_default(".view-init").each((viewEl) => {
				if (viewEl.f7View) return;
				const viewParams = dom7_default(viewEl).dataset();
				app.views.create(viewEl, viewParams);
			});
		},
		"modalOpen panelOpen": function onOpen(instance) {
			const app = this;
			instance.$el.find(".view-init").each((viewEl) => {
				if (viewEl.f7View) return;
				const viewParams = dom7_default(viewEl).dataset();
				app.views.create(viewEl, viewParams);
			});
		},
		"modalBeforeDestroy panelBeforeDestroy": function onClose(instance) {
			if (!instance || !instance.$el) return;
			instance.$el.find(".view-init").each((viewEl) => {
				const view = viewEl.f7View;
				if (!view) return;
				view.destroy();
			});
		}
	},
	vnode: { "view-init": {
		insert(vnode) {
			const app = this;
			const viewEl = vnode.elm;
			if (viewEl.f7View) return;
			const viewParams = dom7_default(viewEl).dataset();
			app.views.create(viewEl, viewParams);
		},
		destroy(vnode) {
			const view = vnode.elm.f7View;
			if (!view) return;
			view.destroy();
		}
	} }
};
var Navbar$1 = {
	size(el) {
		const app = this;
		const $el = dom7_default(el);
		const $innerEl = $el.children(".navbar-inner");
		if (!$innerEl.length) return;
		const needCenterTitle = $innerEl.hasClass("navbar-inner-centered-title") || app.params.navbar[`${app.theme}CenterTitle`];
		const needLeftTitle = app.theme === "ios" && !app.params.navbar[`${app.theme}CenterTitle`];
		if (!needCenterTitle && !needLeftTitle) return;
		if ($el.parents(".tab:not(.tab-active)").length > 0 || $el.parents(".popup:not(.modal-in)").length > 0) return;
		if (app.theme !== "ios" && app.params.navbar[`${app.theme}CenterTitle`]) $innerEl.addClass("navbar-inner-centered-title");
		if (app.theme === "ios" && !app.params.navbar.iosCenterTitle) $innerEl.addClass("navbar-inner-left-title");
		const left = app.rtl ? $innerEl.children(".right") : $innerEl.children(".left");
		const right = app.rtl ? $innerEl.children(".left") : $innerEl.children(".right");
		const title = $innerEl.children(".title");
		const noLeft = left.length === 0;
		const noRight = right.length === 0;
		const leftWidth = noLeft ? 0 : left.outerWidth(true);
		const rightWidth = noRight ? 0 : right.outerWidth(true);
		const titleWidth = title.outerWidth(true);
		const navbarStyles = $innerEl.styles();
		const navbarInnerWidth = $innerEl[0].offsetWidth - parseInt(navbarStyles.paddingLeft, 10) - parseInt(navbarStyles.paddingRight, 10);
		let currLeft;
		let diff;
		if (noRight) currLeft = navbarInnerWidth - titleWidth;
		if (noLeft) currLeft = 0;
		if (!noLeft && !noRight) currLeft = (navbarInnerWidth - rightWidth - titleWidth + leftWidth) / 2;
		let requiredLeft = (navbarInnerWidth - titleWidth) / 2;
		if (navbarInnerWidth - leftWidth - rightWidth > titleWidth) {
			if (requiredLeft < leftWidth) requiredLeft = leftWidth;
			if (requiredLeft + titleWidth > navbarInnerWidth - rightWidth) requiredLeft = navbarInnerWidth - rightWidth - titleWidth;
			diff = requiredLeft - currLeft;
		} else diff = 0;
		if (needCenterTitle) {
			let titleLeft = diff;
			if (app.rtl && noLeft && noRight && title.length > 0) titleLeft = -titleLeft;
			title.css({ left: `${titleLeft}px` });
		}
	},
	hide(el, animate = true, hideStatusbar = false) {
		const app = this;
		const $el = dom7_default(el);
		if (!$el.length) return;
		if ($el.hasClass("navbar-hidden")) return;
		let className = `navbar-hidden${animate ? " navbar-transitioning" : ""}`;
		if ($el.find(".title-large").length) className += " navbar-large-hidden";
		if (hideStatusbar) className += " navbar-hidden-statusbar";
		$el.transitionEnd(() => {
			$el.removeClass("navbar-transitioning");
		});
		$el.addClass(className);
		$el.trigger("navbar:hide");
		app.emit("navbarHide", $el[0]);
	},
	show(el = ".navbar-hidden", animate = true) {
		const app = this;
		const $el = dom7_default(el);
		if (!$el.length) return;
		if (!$el.hasClass("navbar-hidden")) return;
		if (animate) {
			$el.addClass("navbar-transitioning");
			$el.transitionEnd(() => {
				$el.removeClass("navbar-transitioning");
			});
		}
		$el.removeClass("navbar-hidden navbar-large-hidden navbar-hidden-statusbar");
		$el.trigger("navbar:show");
		app.emit("navbarShow", $el[0]);
	},
	getElByPage(page) {
		let $pageEl;
		let $navbarEl;
		let pageData;
		if (page.$navbarEl || page.$el) {
			pageData = page;
			$pageEl = page.$el;
		} else {
			$pageEl = dom7_default(page);
			if ($pageEl.length > 0) pageData = $pageEl[0].f7Page;
		}
		if (pageData && pageData.$navbarEl && pageData.$navbarEl.length > 0) $navbarEl = pageData.$navbarEl;
		else if ($pageEl) $navbarEl = $pageEl.children(".navbar");
		if (!$navbarEl || $navbarEl && $navbarEl.length === 0) return void 0;
		return $navbarEl[0];
	},
	getPageByEl(navbarEl) {
		const $navbarEl = dom7_default(navbarEl);
		if ($navbarEl.parents(".page").length) return $navbarEl.parents(".page")[0];
		let pageEl;
		$navbarEl.parents(".view").find(".page").each((el) => {
			if (el && el.f7Page && el.f7Page.navbarEl && $navbarEl[0] === el.f7Page.navbarEl) pageEl = el;
		});
		return pageEl;
	},
	collapseLargeTitle(navbarEl) {
		const app = this;
		const $navbarEl = dom7_default(navbarEl);
		const $pageEl = dom7_default(app.navbar.getPageByEl($navbarEl));
		$navbarEl.addClass("navbar-large-collapsed");
		$pageEl.eq(0).addClass("page-with-navbar-large-collapsed").trigger("page:navbarlargecollapsed");
		app.emit("pageNavbarLargeCollapsed", $pageEl[0]);
		$navbarEl.trigger("navbar:collapse");
		app.emit("navbarCollapse", $navbarEl[0]);
	},
	expandLargeTitle(navbarEl) {
		const app = this;
		const $navbarEl = dom7_default(navbarEl);
		const $pageEl = dom7_default(app.navbar.getPageByEl($navbarEl));
		$navbarEl.removeClass("navbar-large-collapsed");
		$pageEl.eq(0).removeClass("page-with-navbar-large-collapsed").trigger("page:navbarlargeexpanded");
		app.emit("pageNavbarLargeExpanded", $pageEl[0]);
		$navbarEl.trigger("navbar:expand");
		app.emit("navbarExpand", $navbarEl[0]);
	},
	toggleLargeTitle(navbarEl) {
		const app = this;
		const $navbarEl = dom7_default(navbarEl);
		if ($navbarEl.hasClass("navbar-large-collapsed")) app.navbar.expandLargeTitle($navbarEl);
		else app.navbar.collapseLargeTitle($navbarEl);
	},
	initNavbarOnScroll(pageEl, navbarEl, needHide, needCollapse, needTransparent) {
		const app = this;
		const support = getSupport();
		const $pageEl = dom7_default(pageEl);
		const $navbarEl = dom7_default(navbarEl);
		const $titleLargeEl = $navbarEl.find(".title-large");
		const isLarge = $titleLargeEl.length || $navbarEl.hasClass(".navbar-large");
		let navbarHideHeight = 44;
		const snapPageScrollToLargeTitle = app.params.navbar.snapPageScrollToLargeTitle;
		const snapPageScrollToTransparentNavbar = app.params.navbar.snapPageScrollToTransparentNavbar;
		let previousScrollTop;
		let currentScrollTop;
		let scrollHeight;
		let offsetHeight;
		let reachEnd;
		let action;
		let navbarHidden;
		let navbarCollapsed;
		let navbarTitleLargeHeight;
		let navbarOffsetHeight;
		if (needCollapse || needHide && isLarge) {
			navbarTitleLargeHeight = $navbarEl.css("--f7-navbar-large-title-height");
			if (navbarTitleLargeHeight && navbarTitleLargeHeight.indexOf("px") >= 0) {
				navbarTitleLargeHeight = parseInt(navbarTitleLargeHeight, 10);
				if (Number.isNaN(navbarTitleLargeHeight) && $titleLargeEl.length) navbarTitleLargeHeight = $titleLargeEl[0].offsetHeight;
				else if (Number.isNaN(navbarTitleLargeHeight)) {
					if (app.theme === "ios") navbarTitleLargeHeight = 52;
					else if (app.theme === "md") navbarTitleLargeHeight = 88;
				}
			} else if ($titleLargeEl.length) navbarTitleLargeHeight = $titleLargeEl[0].offsetHeight;
			else if (app.theme === "ios") navbarTitleLargeHeight = 52;
			else if (app.theme === "md") navbarTitleLargeHeight = 88;
		}
		if (needHide && isLarge) navbarHideHeight += navbarTitleLargeHeight;
		let scrollChanged;
		let scrollContent;
		let scrollTimeoutId;
		let touchEndTimeoutId;
		const touchSnapTimeout = 70;
		const desktopSnapTimeout = 300;
		function calcScrollableDistance() {
			$pageEl.find(".page-content").each((pageContentEl) => {
				pageContentEl.f7ScrollableDistance = pageContentEl.scrollHeight - pageContentEl.offsetHeight;
			});
		}
		function snapLargeNavbar() {
			if ($navbarEl.hasClass("with-searchbar-expandable-enabled")) return;
			if (!scrollContent || currentScrollTop < 0) return;
			if (currentScrollTop >= navbarTitleLargeHeight / 2 && currentScrollTop < navbarTitleLargeHeight) dom7_default(scrollContent).scrollTop(navbarTitleLargeHeight, 100);
			else if (currentScrollTop < navbarTitleLargeHeight) dom7_default(scrollContent).scrollTop(0, 200);
		}
		function snapTransparentNavbar() {
			if ($navbarEl.hasClass("with-searchbar-expandable-enabled")) return;
			if (!scrollContent || currentScrollTop < 0) return;
			if (currentScrollTop >= navbarOffsetHeight / 2 && currentScrollTop < navbarOffsetHeight) dom7_default(scrollContent).scrollTop(navbarOffsetHeight, 100);
			else if (currentScrollTop < navbarOffsetHeight) dom7_default(scrollContent).scrollTop(0, 200);
		}
		function handleNavbarTransparent() {
			const isHidden = $navbarEl.hasClass("navbar-hidden");
			if ($navbarEl.hasClass("with-searchbar-expandable-enabled") || isHidden) return;
			if (!navbarOffsetHeight) navbarOffsetHeight = navbarEl.offsetHeight;
			let opacity = currentScrollTop / navbarOffsetHeight;
			const notTransparent = $navbarEl.hasClass("navbar-transparent-visible");
			opacity = Math.max(Math.min(opacity, 1), 0);
			if (notTransparent && opacity === 1 || !notTransparent && opacity === 0) {
				$navbarEl.find(".navbar-bg, .title").css("opacity", "");
				return;
			}
			if (notTransparent && opacity === 0) {
				$navbarEl.trigger("navbar:transparenthide");
				app.emit("navbarTransparentHide", $navbarEl[0]);
				$navbarEl.removeClass("navbar-transparent-visible");
				$navbarEl.find(".navbar-bg, .title").css("opacity", "");
				return;
			}
			if (!notTransparent && opacity === 1) {
				$navbarEl.trigger("navbar:transparentshow");
				app.emit("navbarTransparentShow", $navbarEl[0]);
				$navbarEl.addClass("navbar-transparent-visible");
				$navbarEl.find(".navbar-bg, .title").css("opacity", "");
				return;
			}
			$navbarEl.find(".navbar-bg, .title").css("opacity", opacity);
			if (snapPageScrollToTransparentNavbar) {
				if (!support.touch) {
					clearTimeout(scrollTimeoutId);
					scrollTimeoutId = setTimeout(() => {
						snapTransparentNavbar();
					}, desktopSnapTimeout);
				} else if (touchEndTimeoutId) {
					clearTimeout(touchEndTimeoutId);
					touchEndTimeoutId = null;
					touchEndTimeoutId = setTimeout(() => {
						snapTransparentNavbar();
						clearTimeout(touchEndTimeoutId);
						touchEndTimeoutId = null;
					}, touchSnapTimeout);
				}
			}
		}
		let previousCollapseProgress = null;
		let collapseProgress = null;
		function handleLargeNavbarCollapse(pageContentEl) {
			if ($navbarEl.hasClass("navbar-hidden")) return;
			const isLargeTransparent = $navbarEl.hasClass("navbar-large-transparent") || $navbarEl.hasClass("navbar-large") && $navbarEl.hasClass("navbar-transparent");
			previousCollapseProgress = collapseProgress;
			const scrollableDistance = Math.min(navbarTitleLargeHeight, pageContentEl.f7ScrollableDistance || navbarTitleLargeHeight);
			collapseProgress = Math.min(Math.max(currentScrollTop / scrollableDistance, 0), 1);
			const previousCollapseWasInMiddle = previousCollapseProgress > 0 && previousCollapseProgress < 1;
			if ($navbarEl.hasClass("with-searchbar-expandable-enabled")) return;
			navbarCollapsed = $navbarEl.hasClass("navbar-large-collapsed");
			const $bgEl = $navbarEl.find(".navbar-bg");
			if (collapseProgress === 0 && navbarCollapsed) app.navbar.expandLargeTitle($navbarEl[0]);
			else if (collapseProgress === 1 && !navbarCollapsed) app.navbar.collapseLargeTitle($navbarEl[0]);
			if (collapseProgress === 0 && navbarCollapsed || collapseProgress === 0 && previousCollapseWasInMiddle || collapseProgress === 1 && !navbarCollapsed || collapseProgress === 1 && previousCollapseWasInMiddle) {
				if (app.theme === "md") $navbarEl.find(".navbar-inner").css("overflow", "");
				$navbarEl.find(".title").css("opacity", "");
				$navbarEl.find(".title-large-text, .subnavbar").css("transform", "");
				$navbarEl.find(".title-large-text").css("opacity", "");
				if (app.theme === "md") {
					if (isLargeTransparent) $bgEl.css("opacity", "");
					$bgEl.css("transform", "");
				}
			} else if (collapseProgress > 0 && collapseProgress < 1) {
				if (app.theme === "md") $navbarEl.find(".navbar-inner").css("overflow", "visible");
				$navbarEl.find(".title").css("opacity", -.5 + collapseProgress * 1.5);
				$navbarEl.find(".title-large-text, .subnavbar").css("transform", `translate3d(0px, ${-1 * collapseProgress * navbarTitleLargeHeight}px, 0)`);
				$navbarEl.find(".title-large-text").css("opacity", 1 - collapseProgress * 2);
				if (app.theme === "md") {
					if (isLargeTransparent) $bgEl.css("opacity", collapseProgress);
					$bgEl.css("transform", `translate3d(0px, ${-1 * collapseProgress * navbarTitleLargeHeight}px, 0)`);
				}
			}
			if (snapPageScrollToLargeTitle) {
				if (!support.touch) {
					clearTimeout(scrollTimeoutId);
					scrollTimeoutId = setTimeout(() => {
						snapLargeNavbar();
					}, desktopSnapTimeout);
				} else if (touchEndTimeoutId) {
					clearTimeout(touchEndTimeoutId);
					touchEndTimeoutId = null;
					touchEndTimeoutId = setTimeout(() => {
						snapLargeNavbar();
						clearTimeout(touchEndTimeoutId);
						touchEndTimeoutId = null;
					}, touchSnapTimeout);
				}
			}
		}
		function handleTitleHideShow() {
			if ($pageEl.hasClass("page-with-card-opened")) return;
			scrollHeight = scrollContent.scrollHeight;
			offsetHeight = scrollContent.offsetHeight;
			reachEnd = currentScrollTop + offsetHeight >= scrollHeight;
			navbarHidden = $navbarEl.hasClass("navbar-hidden");
			if (reachEnd) {
				if (app.params.navbar.showOnPageScrollEnd) action = "show";
			} else if (previousScrollTop > currentScrollTop) {
				if (app.params.navbar.showOnPageScrollTop || currentScrollTop <= navbarHideHeight) action = "show";
				else action = "hide";
			} else if (currentScrollTop > navbarHideHeight) action = "hide";
			else action = "show";
			if (action === "show" && navbarHidden) {
				app.navbar.show($navbarEl, true, true);
				navbarHidden = false;
			} else if (action === "hide" && !navbarHidden) {
				app.navbar.hide($navbarEl, true, false, true);
				navbarHidden = true;
			}
			previousScrollTop = currentScrollTop;
		}
		function handleScroll(e) {
			scrollContent = this;
			if (e && e.target && e.target !== scrollContent) return;
			currentScrollTop = scrollContent.scrollTop;
			scrollChanged = currentScrollTop;
			if (needCollapse) handleLargeNavbarCollapse(scrollContent);
			else if (needTransparent) handleNavbarTransparent();
			if ($pageEl.hasClass("page-previous")) return;
			if (needHide) handleTitleHideShow();
		}
		function handeTouchStart() {
			scrollChanged = false;
		}
		function handleTouchEnd() {
			clearTimeout(touchEndTimeoutId);
			touchEndTimeoutId = null;
			touchEndTimeoutId = setTimeout(() => {
				if (scrollChanged !== false) {
					if (needTransparent && !needCollapse) snapTransparentNavbar();
					else snapLargeNavbar();
					clearTimeout(touchEndTimeoutId);
					touchEndTimeoutId = null;
				}
			}, touchSnapTimeout);
		}
		$pageEl.on("scroll", ".page-content", handleScroll, true);
		if (support.touch && (needCollapse && snapPageScrollToLargeTitle || needTransparent && snapPageScrollToTransparentNavbar)) {
			app.on("touchstart:passive", handeTouchStart);
			app.on("touchend:passive", handleTouchEnd);
		}
		calcScrollableDistance();
		if (needCollapse || needTransparent) $pageEl.find(".page-content").each((pageContentEl) => {
			if (pageContentEl.scrollTop > 0) handleScroll.call(pageContentEl);
		});
		app.on("resize", calcScrollableDistance);
		$pageEl[0].f7DetachNavbarScrollHandlers = function f7DetachNavbarScrollHandlers() {
			app.off("resize", calcScrollableDistance);
			delete $pageEl[0].f7DetachNavbarScrollHandlers;
			$pageEl.off("scroll", ".page-content", handleScroll, true);
			if (support.touch && (needCollapse && snapPageScrollToLargeTitle || needTransparent && snapPageScrollToTransparentNavbar)) {
				app.off("touchstart:passive", handeTouchStart);
				app.off("touchend:passive", handleTouchEnd);
			}
		};
	}
};
var navbar_default = {
	name: "navbar",
	create() {
		bindMethods(this, { navbar: Navbar$1 });
	},
	params: { navbar: {
		scrollTopOnTitleClick: true,
		iosCenterTitle: true,
		mdCenterTitle: false,
		hideOnPageScroll: false,
		showOnPageScrollEnd: true,
		showOnPageScrollTop: true,
		collapseLargeTitleOnScroll: true,
		snapPageScrollToLargeTitle: true,
		snapPageScrollToTransparentNavbar: true
	} },
	on: {
		"panelBreakpoint panelCollapsedBreakpoint panelResize viewResize resize viewMasterDetailBreakpoint": function onPanelResize() {
			const app = this;
			dom7_default(".navbar").each((navbarEl) => {
				app.navbar.size(navbarEl);
			});
		},
		pageBeforeRemove(page) {
			if (page.$el[0].f7DetachNavbarScrollHandlers) page.$el[0].f7DetachNavbarScrollHandlers();
		},
		pageReinit(page) {
			const app = this;
			const $navbarEl = dom7_default(app.navbar.getElByPage(page));
			if (!$navbarEl || $navbarEl.length === 0) return;
			app.navbar.size($navbarEl);
		},
		pageInit(page) {
			const app = this;
			const $navbarEl = dom7_default(app.navbar.getElByPage(page));
			if (!$navbarEl || $navbarEl.length === 0) return;
			app.navbar.size($navbarEl);
			let needCollapseOnScrollHandler;
			if ($navbarEl.find(".title-large").length > 0) $navbarEl.addClass("navbar-large");
			if ($navbarEl.hasClass("navbar-large")) {
				if (app.params.navbar.collapseLargeTitleOnScroll) needCollapseOnScrollHandler = true;
				page.$el.addClass("page-with-navbar-large");
			}
			let needTransparentOnScroll;
			if (!needCollapseOnScrollHandler && $navbarEl.hasClass("navbar-transparent")) needTransparentOnScroll = true;
			let needHideOnScrollHandler;
			if (app.params.navbar.hideOnPageScroll || page.$el.find(".hide-navbar-on-scroll").length || page.$el.hasClass("hide-navbar-on-scroll") || page.$el.find(".hide-bars-on-scroll").length || page.$el.hasClass("hide-bars-on-scroll")) {
				if (page.$el.find(".keep-navbar-on-scroll").length || page.$el.hasClass("keep-navbar-on-scroll") || page.$el.find(".keep-bars-on-scroll").length || page.$el.hasClass("keep-bars-on-scroll")) needHideOnScrollHandler = false;
				else needHideOnScrollHandler = true;
			}
			if (needCollapseOnScrollHandler || needHideOnScrollHandler || needTransparentOnScroll) app.navbar.initNavbarOnScroll(page.el, $navbarEl[0], needHideOnScrollHandler, needCollapseOnScrollHandler, needTransparentOnScroll);
		},
		"panelOpen panelSwipeOpen modalOpen": function onPanelModalOpen(instance) {
			const app = this;
			instance.$el.find(".navbar").each((navbarEl) => {
				app.navbar.size(navbarEl);
			});
		},
		tabShow(tabEl) {
			const app = this;
			dom7_default(tabEl).find(".navbar").each((navbarEl) => {
				app.navbar.size(navbarEl);
			});
		}
	},
	clicks: { ".navbar .title": function onTitleClick($clickedEl, clickedData, e) {
		if (!this.params.navbar.scrollTopOnTitleClick) return;
		if (dom7_default(e.target).closest("a, button").length > 0) return;
		let $pageContentEl;
		const $navbarEl = $clickedEl.parents(".navbar");
		$pageContentEl = $navbarEl.parents(".page-content");
		if ($pageContentEl.length === 0) {
			if ($navbarEl.parents(".page").length > 0) $pageContentEl = $navbarEl.parents(".page").find(".page-content");
		}
		if ($pageContentEl && $pageContentEl.length > 0) {
			if ($pageContentEl.hasClass("tab")) $pageContentEl = $pageContentEl.parent(".tabs").children(".page-content.tab-active");
			if ($pageContentEl.length > 0) $pageContentEl.scrollTop(0, 300);
		}
	} },
	vnode: { navbar: { postpatch(vnode) {
		this.navbar.size(vnode.elm);
	} } }
};
var startAnimation = (data) => {
	data.raf = requestAnimationFrame(() => {
		if (!data.setTransform) return;
		const highlightEl = data.highlightEl;
		if (!highlightEl) return;
		highlightEl.style.transform = data.setTransform;
		highlightEl.style.transitionTimingFunction = "ease-out";
		data.setTransform = null;
	});
};
var stopAnimation = (data) => {
	cancelAnimationFrame(data.raf);
};
var setHighlightOnTouch = (data, e) => {
	const { rect, linkEls, highlightEl } = data;
	if (!highlightEl) return;
	const { clientX } = e;
	const highlightWidth = rect.width / linkEls.length;
	const leftOffset = clientX - rect.left - highlightWidth / 2;
	const minLeft = 0;
	const maxLeft = rect.width - highlightWidth;
	const translateX = Math.max(minLeft, Math.min(leftOffset, maxLeft));
	const linkCenters = [...linkEls].map((el, index) => {
		return index * highlightWidth + highlightWidth / 2;
	});
	const closestLinkCenter = linkCenters.reduce((prev, curr) => {
		const highlightCenter = translateX + highlightWidth / 2;
		return Math.abs(curr - highlightCenter) < Math.abs(prev - highlightCenter) ? curr : prev;
	}, linkCenters[0]);
	data.newActiveIndex = linkCenters.indexOf(closestLinkCenter);
	highlightEl.classList.add("tab-link-highlight-pressed");
	data.setTransform = `translateX(${translateX}px)`;
	startAnimation(data);
};
var unsetHighlightOnTouch = (data) => {
	cancelAnimationFrame(data.raf);
	data.setTransform = null;
	const { highlightEl } = data;
	if (!highlightEl) return;
	highlightEl.classList.remove("tab-link-highlight-pressed");
	const { activeIndex, newActiveIndex, linkEls } = data;
	if (activeIndex !== newActiveIndex) linkEls[newActiveIndex].click();
	highlightEl.style.transform = `translateX(${newActiveIndex * 100}%)`;
	highlightEl.style.transitionTimingFunction = "";
	highlightEl.style.transform = `translateX(${newActiveIndex * 100}%)`;
};
var initTabbarHighlight = (el) => {
	const document = getDocument();
	if (!el) return;
	if (el.classList.contains("tabbar-scrollable")) return;
	const highlightEl = el.querySelector(".tab-link-highlight");
	const toolbarPaneEl = el.querySelector(".toolbar-pane");
	if (!highlightEl || !toolbarPaneEl) return;
	const data = {
		el,
		highlightEl,
		touched: false,
		moved: false,
		rect: null,
		setTransform: null,
		raf: null
	};
	el.f7ToolbarHighlightData = data;
	el.f7ToolbarOnPointer = (e) => {
		if (e.type === "touchstart") e.preventDefault();
		if (e.pointerType !== "touch") return;
		if (!el) return;
		if (e.type === "pointerdown") {
			data.linkEls = el.querySelectorAll(".tab-link");
			data.activeIndex = [...data.linkEls].findIndex((link) => link.classList.contains("tab-link-active"));
			data.rect = toolbarPaneEl.getBoundingClientRect();
			data.touched = true;
			setHighlightOnTouch(data, e);
			startAnimation(data);
		}
		if (e.type === "pointermove") {
			if (!data.touched) return;
			data.moved = true;
			setHighlightOnTouch(data, e);
		}
		if (e.type === "pointerup") {
			if (!data.touched) return;
			data.touched = false;
			data.moved = false;
			unsetHighlightOnTouch(data);
			stopAnimation(data);
		}
		if (e.type === "pointercancel") {
			if (!data.touched) return;
			data.touched = false;
			data.moved = false;
			data.setTransform = null;
			stopAnimation(data);
			if (highlightEl) {
				highlightEl.classList.remove("tab-link-highlight-pressed");
				highlightEl.style.transform = `translateX(${data.activeIndex * 100}%)`;
				highlightEl.style.transitionTimingFunction = "";
			}
		}
	};
	el.addEventListener("touchstart", el.f7ToolbarOnPointer, { passive: false });
	el.addEventListener("pointerdown", el.f7ToolbarOnPointer, { passive: false });
	document.addEventListener("pointermove", el.f7ToolbarOnPointer, { passive: false });
	document.addEventListener("pointerup", el.f7ToolbarOnPointer, { passive: false });
	document.addEventListener("pointercancel", el.f7ToolbarOnPointer, { passive: false });
};
var destroyTabbarHighlight = (el) => {
	if (!el || !el.f7ToolbarOnPointer) return;
	const document = getDocument();
	el.removeEventListener("touchstart", el.f7ToolbarOnPointer);
	el.removeEventListener("pointerdown", el.f7ToolbarOnPointer);
	document.removeEventListener("pointermove", el.f7ToolbarOnPointer);
	document.removeEventListener("pointerup", el.f7ToolbarOnPointer);
	document.removeEventListener("pointercancel", el.f7ToolbarOnPointer);
	el.f7ToolbarOnPointer = null;
	el.f7ToolbarHighlightData = null;
};
var Toolbar = {
	setHighlight(tabbarEl) {
		const app = this;
		const $tabbarEl = dom7_default(tabbarEl);
		if ($tabbarEl.length === 0 || !($tabbarEl.hasClass("tabbar") || $tabbarEl.hasClass("tabbar-icons"))) return;
		let $highlightEl = $tabbarEl.find(".tab-link-highlight");
		const tabLinksCount = $tabbarEl.find(".tab-link").length;
		if (tabLinksCount === 0) {
			$highlightEl.remove();
			return;
		}
		if ($highlightEl.length === 0) {
			if (app.theme === "ios") $tabbarEl.children(".toolbar-inner").children(".toolbar-pane").append("<span class=\"tab-link-highlight\"></span>");
			else $tabbarEl.children(".toolbar-inner").append("<span class=\"tab-link-highlight\"></span>");
			$highlightEl = $tabbarEl.find(".tab-link-highlight");
		} else if ($highlightEl.next("a,button,.tab-link").length) {
			if (app.theme === "ios") $tabbarEl.children(".toolbar-inner").children(".toolbar-pane").append($highlightEl);
			else $tabbarEl.children(".toolbar-inner").append($highlightEl);
		}
		const $activeLink = $tabbarEl.find(".tab-link-active");
		let highlightWidth;
		let highlightTranslate;
		if ($tabbarEl.hasClass("tabbar-scrollable") && $activeLink && $activeLink[0]) {
			highlightWidth = `${$activeLink[0].offsetWidth}px`;
			highlightTranslate = `${$activeLink[0].offsetLeft}px`;
		} else {
			const activeIndex = $activeLink.index();
			highlightWidth = `${100 / tabLinksCount}%`;
			highlightTranslate = `${(app.rtl ? -activeIndex : activeIndex) * 100}%`;
		}
		nextFrame$1(() => {
			$highlightEl.css("width", highlightWidth).transform(`translate3d(${highlightTranslate},0,0)`);
		});
	},
	init(tabbarEl) {
		const app = this;
		app.toolbar.setHighlight(tabbarEl);
		if (app.theme !== "ios") return;
		initTabbarHighlight(tabbarEl);
	},
	destroy(tabbarEl) {
		if (this.theme !== "ios") return;
		destroyTabbarHighlight(tabbarEl);
	},
	hide(el, animate = true) {
		const app = this;
		const $el = dom7_default(el);
		if ($el.hasClass("toolbar-hidden")) return;
		const className = `toolbar-hidden${animate ? " toolbar-transitioning" : ""}`;
		$el.transitionEnd(() => {
			$el.removeClass("toolbar-transitioning");
		});
		$el.addClass(className);
		$el.trigger("toolbar:hide");
		app.emit("toolbarHide", $el[0]);
	},
	show(el, animate = true) {
		const app = this;
		const $el = dom7_default(el);
		if (!$el.hasClass("toolbar-hidden")) return;
		if (animate) {
			$el.addClass("toolbar-transitioning");
			$el.transitionEnd(() => {
				$el.removeClass("toolbar-transitioning");
			});
		}
		$el.removeClass("toolbar-hidden");
		$el.trigger("toolbar:show");
		app.emit("toolbarShow", $el[0]);
	},
	initToolbarOnScroll(pageEl) {
		const app = this;
		const $pageEl = dom7_default(pageEl);
		let $toolbarEl = $pageEl.parents(".view").children(".toolbar");
		if ($toolbarEl.length === 0) $toolbarEl = $pageEl.find(".toolbar");
		if ($toolbarEl.length === 0) $toolbarEl = $pageEl.parents(".views").children(".tabbar, .tabbar-icons");
		if ($toolbarEl.length === 0) return;
		let previousScrollTop;
		let currentScrollTop;
		let scrollHeight;
		let offsetHeight;
		let reachEnd;
		let action;
		let toolbarHidden;
		function handleScroll(e) {
			if ($pageEl.hasClass("page-with-card-opened")) return;
			if ($pageEl.hasClass("page-previous")) return;
			const scrollContent = this;
			if (e && e.target && e.target !== scrollContent) return;
			currentScrollTop = scrollContent.scrollTop;
			scrollHeight = scrollContent.scrollHeight;
			offsetHeight = scrollContent.offsetHeight;
			reachEnd = currentScrollTop + offsetHeight >= scrollHeight;
			toolbarHidden = $toolbarEl.hasClass("toolbar-hidden");
			if (reachEnd) {
				if (app.params.toolbar.showOnPageScrollEnd) action = "show";
			} else if (previousScrollTop > currentScrollTop) {
				if (app.params.toolbar.showOnPageScrollTop || currentScrollTop <= 44) action = "show";
				else action = "hide";
			} else if (currentScrollTop > 44) action = "hide";
			else action = "show";
			if (action === "show" && toolbarHidden) {
				app.toolbar.show($toolbarEl);
				toolbarHidden = false;
			} else if (action === "hide" && !toolbarHidden) {
				app.toolbar.hide($toolbarEl);
				toolbarHidden = true;
			}
			previousScrollTop = currentScrollTop;
		}
		$pageEl.on("scroll", ".page-content", handleScroll, true);
		$pageEl[0].f7ScrollToolbarHandler = handleScroll;
	}
};
var toolbar_default = {
	name: "toolbar",
	create() {
		bindMethods(this, { toolbar: Toolbar });
	},
	params: { toolbar: {
		hideOnPageScroll: false,
		showOnPageScrollEnd: true,
		showOnPageScrollTop: true
	} },
	on: {
		pageBeforeRemove(page) {
			const app = this;
			if (page.$el[0].f7ScrollToolbarHandler) page.$el.off("scroll", ".page-content", page.$el[0].f7ScrollToolbarHandler, true);
			page.$el.find(".tabbar, .tabbar-icons").each((tabbarEl) => {
				app.toolbar.destroy(tabbarEl);
			});
		},
		pageBeforeIn(page) {
			const app = this;
			let $toolbarEl = page.$el.parents(".view").children(".toolbar");
			if ($toolbarEl.length === 0) $toolbarEl = page.$el.parents(".views").children(".tabbar, .tabbar-icons");
			if ($toolbarEl.length === 0) $toolbarEl = page.$el.find(".toolbar");
			if ($toolbarEl.length === 0) return;
			if (page.$el.hasClass("no-toolbar")) app.toolbar.hide($toolbarEl);
			else app.toolbar.show($toolbarEl);
		},
		pageInit(page) {
			const app = this;
			page.$el.find(".tabbar, .tabbar-icons").each((tabbarEl) => {
				app.toolbar.init(tabbarEl);
			});
			if (app.params.toolbar.hideOnPageScroll || page.$el.find(".hide-toolbar-on-scroll").length || page.$el.hasClass("hide-toolbar-on-scroll") || page.$el.find(".hide-bars-on-scroll").length || page.$el.hasClass("hide-bars-on-scroll")) {
				if (page.$el.find(".keep-toolbar-on-scroll").length || page.$el.hasClass("keep-toolbar-on-scroll") || page.$el.find(".keep-bars-on-scroll").length || page.$el.hasClass("keep-bars-on-scroll")) return;
				app.toolbar.initToolbarOnScroll(page.el);
			}
		},
		init() {
			const app = this;
			app.$el.find(".tabbar, .tabbar-icons").each((tabbarEl) => {
				app.toolbar.init(tabbarEl);
			});
		}
	},
	vnode: { tabbar: {
		insert(vnode) {
			this.toolbar.init(vnode.elm);
		},
		destroy(vnode) {
			this.toolbar.destroy(vnode.elm);
		}
	} }
};
var subnavbar_default = {
	name: "subnavbar",
	on: { pageInit(page) {
		if (page.$navbarEl && page.$navbarEl.length && page.$navbarEl.find(".subnavbar").length) page.$el.addClass("page-with-subnavbar");
		if (page.$el.find(".subnavbar").filter((subnavbarEl) => {
			return dom7_default(subnavbarEl).parents(".page")[0] === page.$el[0];
		}).length) page.$el.addClass("page-with-subnavbar");
	} }
};
var TouchRipple = class {
	constructor(app, $el, x, y) {
		const ripple = this;
		if (!$el) return void 0;
		const { left, top, width, height } = $el[0].getBoundingClientRect();
		const center = {
			x: x - left,
			y: y - top
		};
		let diameter = Math.max((height ** 2 + width ** 2) ** .5, 48);
		let isInset = false;
		const insetElements = app.params.touch.touchRippleInsetElements || "";
		if (insetElements && $el.is(insetElements)) isInset = true;
		if (isInset) diameter = Math.max(Math.min(width, height), 48);
		if (!isInset && $el.css("overflow") === "hidden") {
			const distanceFromCenter = ((center.x - width / 2) ** 2 + (center.y - height / 2) ** 2) ** .5;
			ripple.rippleTransform = `translate3d(0px, 0px, 0) scale(${(diameter / 2 + distanceFromCenter) / (diameter / 2) * 2})`;
		} else ripple.rippleTransform = `translate3d(${-center.x + width / 2}px, ${-center.y + height / 2}px, 0) scale(1)`;
		if (isInset) $el.addClass("ripple-inset");
		ripple.$rippleWaveEl = dom7_default(`<div class="ripple-wave${isInset ? " ripple-wave-inset" : ""}" style="width: ${diameter}px; height: ${diameter}px; margin-top:-${diameter / 2}px; margin-left:-${diameter / 2}px; left:${center.x}px; top:${center.y}px; --f7-ripple-transform: ${ripple.rippleTransform}"></div>`);
		$el.prepend(ripple.$rippleWaveEl);
		ripple.$rippleWaveEl.animationEnd(() => {
			if (!ripple.$rippleWaveEl) return;
			if (ripple.$rippleWaveEl.hasClass("ripple-wave-out")) return;
			ripple.$rippleWaveEl.addClass("ripple-wave-in");
			if (ripple.shouldBeRemoved) ripple.out();
		});
		return ripple;
	}
	destroy() {
		let ripple = this;
		if (ripple.$rippleWaveEl) ripple.$rippleWaveEl.remove();
		Object.keys(ripple).forEach((key) => {
			ripple[key] = null;
			delete ripple[key];
		});
		ripple = null;
	}
	out() {
		const ripple = this;
		const { $rippleWaveEl } = this;
		clearTimeout(ripple.removeTimeout);
		$rippleWaveEl.addClass("ripple-wave-out");
		ripple.removeTimeout = setTimeout(() => {
			ripple.destroy();
		}, 300);
		$rippleWaveEl.animationEnd(() => {
			clearTimeout(ripple.removeTimeout);
			ripple.destroy();
		});
	}
	remove() {
		const ripple = this;
		if (ripple.shouldBeRemoved) return;
		ripple.removeTimeout = setTimeout(() => {
			ripple.destroy();
		}, 400);
		ripple.shouldBeRemoved = true;
		if (ripple.$rippleWaveEl.hasClass("ripple-wave-in")) ripple.out();
	}
};
var touch_ripple_default = {
	name: "touch-ripple",
	static: { TouchRipple },
	create() {
		const app = this;
		app.touchRipple = { create(...args) {
			return new TouchRipple(...args);
		} };
	}
};
var initTouchHighlight = (app) => {
	const document = getDocument();
	const isEnabled = app.params.touch.touchHighlight;
	const elements = app.params.touch.touchHighlightElements;
	const data = {};
	const offset = 1;
	const zIndex = 500;
	const removeHoverHighlight = () => {
		const el = data.currentEl;
		if (el && data.elScale) {
			data.elScale = false;
			el.style.scale = "";
			const onTransitionEnd = () => {
				el.style.transitionDuration = "";
				el.style.transitionTimingFunction = "";
				el.removeEventListener("transitionend", onTransitionEnd);
			};
			el.addEventListener("transitionend", onTransitionEnd);
		}
		if (data.lightElWrap) {
			const lightElWrap = data.lightElWrap;
			if (lightElWrap.style.opacity === "0") lightElWrap.remove();
			else {
				lightElWrap.addEventListener("transitionend", () => {
					lightElWrap.remove();
				});
				lightElWrap.style.opacity = 0;
			}
		}
		data.currentEl = null;
		data.lightElWrap = null;
		data.lightEl = null;
	};
	const setLightPosition = (e) => {
		if (data.lightEl) {
			const { x, y } = e;
			const offsetX = x - data.rect.x;
			const offsetY = y - data.rect.y;
			data.lightEl.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
		}
	};
	const onPointerMove = (e) => {
		if (!isEnabled) return;
		setLightPosition(e);
	};
	const onPointerLeave = () => {
		if (!isEnabled) return;
		removeHoverHighlight();
	};
	const onPointerDown = (e) => {
		if (!isEnabled) return;
		if (e.pointerType === "mouse") return;
		const d = data;
		const el = e.target.closest(elements);
		if (!el) return;
		if (el.closest(".tabbar-scrollable")) return;
		if (d.currentEl === el) return;
		d.currentEl = el;
		d.rect = el.getBoundingClientRect();
		const lightElWrap = document.createElement("span");
		lightElWrap.className = "rounded-[inherit]";
		lightElWrap.style = `left: ${offset}px; top: ${offset}px; right: ${offset}px; bottom: ${offset}px;transition-duration: 300ms; opacity: 0; position: absolute; overflow: hidden; pointer-events: none; border-radius: inherit;`;
		const lightEl = document.createElement("span");
		const { width, height } = d.rect;
		const radius = (width ** 2 + height ** 2) ** .5;
		lightEl.style.position = `absolute`;
		lightEl.style.zIndex = zIndex;
		lightEl.style.width = `${radius * 2}px`;
		lightEl.style.left = `${-radius}px`;
		lightEl.style.height = `${radius * 2}px`;
		lightEl.style.top = `${-radius}px`;
		lightEl.style.borderRadius = `50%`;
		const lightColor = "var(--f7-touch-highlight-bg-color)";
		lightEl.style.backgroundImage = `radial-gradient(circle at center, color-mix(in oklab, ${lightColor} 100%, transparent), transparent 50%)`;
		lightEl.style.pointerEvents = "none";
		d.lightEl = lightEl;
		d.lightElWrap = lightElWrap;
		setLightPosition(e);
		lightElWrap.append(lightEl);
		el.append(lightElWrap);
		if (e.pointerType !== "mouse") {
			if (e.pointerType !== "mouse") {
				d.elScale = true;
				let scale = 1.25;
				if (d.rect.width > 60 || d.rect.height > 60) scale = 1.05;
				el.style.scale = scale;
				el.style.transitionDuration = "300ms";
				el.style.transitionTimingFunction = "ease-in-out";
			}
		}
		requestAnimationFrame(() => {
			lightElWrap.style.opacity = 1;
		});
		el.removeEventListener("pointermove", onPointerMove);
		el.removeEventListener("pointerleave", onPointerLeave);
		el.addEventListener("pointermove", onPointerMove);
		el.addEventListener("pointerleave", onPointerLeave);
	};
	document.addEventListener("pointerdown", onPointerDown, { capture: true });
	document.addEventListener("contextmenu", onPointerLeave, { capture: true });
};
var touch_highlight_default = {
	name: "touch-highlight",
	on: { init() {
		initTouchHighlight(this);
	} }
};
var openedModals = [];
var dialogsQueue = [];
function clearDialogsQueue() {
	if (dialogsQueue.length === 0) return;
	dialogsQueue.shift().open();
}
var Modal = class extends Framework7Class {
	constructor(app, params) {
		super(params, [app]);
		const modal = this;
		const defaults = {};
		modal.useModulesParams(defaults);
		modal.params = extend$1(defaults, params);
		modal.opened = false;
		let $containerEl = modal.params.containerEl ? dom7_default(modal.params.containerEl).eq(0) : app.$el;
		if (!$containerEl.length) $containerEl = app.$el;
		modal.$containerEl = $containerEl;
		modal.containerEl = $containerEl[0];
		modal.useModules();
		return this;
	}
	onOpen() {
		const modal = this;
		modal.opened = true;
		openedModals.push(modal);
		dom7_default("html").addClass(`with-modal-${modal.type.toLowerCase()}`);
		modal.$el.trigger(`modal:open ${modal.type.toLowerCase()}:open`);
		modal.emit(`local::open modalOpen ${modal.type}Open`, modal);
	}
	onOpened() {
		const modal = this;
		modal.$el.trigger(`modal:opened ${modal.type.toLowerCase()}:opened`);
		modal.emit(`local::opened modalOpened ${modal.type}Opened`, modal);
	}
	onClose() {
		const modal = this;
		modal.opened = false;
		if (!modal.type || !modal.$el) return;
		openedModals.splice(openedModals.indexOf(modal), 1);
		dom7_default("html").removeClass(`with-modal-${modal.type.toLowerCase()}`);
		modal.$el.trigger(`modal:close ${modal.type.toLowerCase()}:close`);
		modal.emit(`local::close modalClose ${modal.type}Close`, modal);
	}
	onClosed() {
		const modal = this;
		if (!modal.type || !modal.$el) return;
		modal.$el.removeClass("modal-out");
		modal.$el.hide();
		if (modal.params.backdrop && (modal.params.backdropUnique || modal.forceBackdropUnique) && modal.$backdropEl) modal.$backdropEl.remove();
		modal.$el.trigger(`modal:closed ${modal.type.toLowerCase()}:closed`);
		modal.emit(`local::closed modalClosed ${modal.type}Closed`, modal);
	}
	open(animateModal, force) {
		const modal = this;
		const document = getDocument();
		const app = modal.app;
		const $el = modal.$el;
		const $backdropEl = modal.$backdropEl;
		const type = modal.type;
		let animate = true;
		if (typeof animateModal !== "undefined") animate = animateModal;
		else if (typeof modal.params.animate !== "undefined") animate = modal.params.animate;
		if (!$el || $el.hasClass("modal-in")) {
			if (animateModal === false && $el[0] && type !== "dialog") $el[0].style.display = "block";
			if (!force) return modal;
		}
		if (type === "dialog" && app.params.modal.queueDialogs) {
			let pushToQueue;
			if (dom7_default(".dialog.modal-in").length > 0) pushToQueue = true;
			else if (openedModals.length > 0) openedModals.forEach((openedModal) => {
				if (openedModal.type === "dialog") pushToQueue = true;
			});
			if (pushToQueue) {
				dialogsQueue.push(modal);
				return modal;
			}
		}
		const $modalParentEl = $el.parent();
		const wasInDom = $el.parents(document).length > 0;
		if (!$modalParentEl.is(modal.$containerEl)) {
			modal.$containerEl.append($el);
			modal.once(`${type}Closed`, () => {
				if (wasInDom) $modalParentEl.append($el);
				else $el.remove();
			});
		}
		$el.show();
		if (modal.params.backdrop && (modal.params.backdropUnique || modal.forceBackdropUnique) && modal.$backdropEl) modal.$backdropEl.insertBefore($el);
		modal._clientLeft = $el[0].clientLeft;
		function transitionEnd() {
			if ($el.hasClass("modal-out")) modal.onClosed();
			else if ($el.hasClass("modal-in")) modal.onOpened();
		}
		if (animate) {
			if ($backdropEl) {
				$backdropEl.removeClass("not-animated");
				$backdropEl.addClass("backdrop-in");
			}
			$el.animationEnd(() => {
				transitionEnd();
			});
			$el.transitionEnd(() => {
				transitionEnd();
			});
			$el.removeClass("modal-out not-animated").addClass("modal-in");
			modal.onOpen();
		} else {
			if ($backdropEl) $backdropEl.addClass("backdrop-in not-animated");
			$el.removeClass("modal-out").addClass("modal-in not-animated");
			modal.onOpen();
			modal.onOpened();
		}
		return modal;
	}
	close(animateModal) {
		const modal = this;
		const $el = modal.$el;
		const $backdropEl = modal.$backdropEl;
		let animate = true;
		if (typeof animateModal !== "undefined") animate = animateModal;
		else if (typeof modal.params.animate !== "undefined") animate = modal.params.animate;
		if (!$el || !$el.hasClass("modal-in")) {
			if (dialogsQueue.indexOf(modal) >= 0) dialogsQueue.splice(dialogsQueue.indexOf(modal), 1);
			return modal;
		}
		if ($backdropEl) {
			let needToHideBackdrop = true;
			if (modal.type === "popup") modal.$el.prevAll(".popup.modal-in").add(modal.$el.nextAll(".popup.modal-in")).each((popupEl) => {
				const popupInstance = popupEl.f7Modal;
				if (!popupInstance) return;
				if (popupInstance.params.closeByBackdropClick && popupInstance.params.backdrop && popupInstance.backdropEl === modal.backdropEl) needToHideBackdrop = false;
			});
			if (needToHideBackdrop) {
				$backdropEl[animate ? "removeClass" : "addClass"]("not-animated");
				$backdropEl.removeClass("backdrop-in");
			}
		}
		$el[animate ? "removeClass" : "addClass"]("not-animated");
		function transitionEnd() {
			if ($el.hasClass("modal-out")) modal.onClosed();
			else if ($el.hasClass("modal-in")) modal.onOpened();
		}
		if (animate) {
			$el.animationEnd(() => {
				transitionEnd();
			});
			$el.transitionEnd(() => {
				transitionEnd();
			});
			$el.removeClass("modal-in").addClass("modal-out");
			modal.onClose();
		} else {
			$el.addClass("not-animated").removeClass("modal-in").addClass("modal-out");
			modal.onClose();
			modal.onClosed();
		}
		if (modal.type === "dialog") clearDialogsQueue();
		return modal;
	}
	destroy() {
		const modal = this;
		if (modal.destroyed) return;
		modal.emit(`local::beforeDestroy modalBeforeDestroy ${modal.type}BeforeDestroy`, modal);
		if (modal.$el) {
			modal.$el.trigger(`modal:beforedestroy ${modal.type.toLowerCase()}:beforedestroy`);
			if (modal.$el.length && modal.$el[0].f7Modal) delete modal.$el[0].f7Modal;
		}
		deleteProps(modal);
		modal.destroyed = true;
	}
};
var CustomModal = class extends Modal {
	constructor(app, params) {
		const extendedParams = extend$1({
			backdrop: true,
			closeByBackdropClick: true,
			on: {}
		}, params);
		super(app, extendedParams);
		const customModal = this;
		customModal.params = extendedParams;
		let $el;
		if (!customModal.params.el) $el = dom7_default(customModal.params.content);
		else $el = dom7_default(customModal.params.el);
		if ($el && $el.length > 0 && $el[0].f7Modal) return $el[0].f7Modal;
		if ($el.length === 0) return customModal.destroy();
		let $backdropEl;
		if (customModal.params.backdrop) {
			$backdropEl = app.$el.children(".custom-modal-backdrop");
			if ($backdropEl.length === 0) {
				$backdropEl = dom7_default("<div class=\"custom-modal-backdrop\"></div>");
				app.$el.append($backdropEl);
			}
		}
		function handleClick(e) {
			if (!customModal || customModal.destroyed) return;
			if ($backdropEl && e.target === $backdropEl[0]) customModal.close();
		}
		customModal.on("customModalOpened", () => {
			if (customModal.params.closeByBackdropClick && customModal.params.backdrop) app.on("click", handleClick);
		});
		customModal.on("customModalClose", () => {
			if (customModal.params.closeByBackdropClick && customModal.params.backdrop) app.off("click", handleClick);
		});
		extend$1(customModal, {
			app,
			$el,
			el: $el[0],
			$backdropEl,
			backdropEl: $backdropEl && $backdropEl[0],
			type: "customModal"
		});
		$el[0].f7Modal = customModal;
		return customModal;
	}
};
var modal_default = {
	name: "modal",
	static: {
		Modal,
		CustomModal
	},
	create() {
		const app = this;
		app.customModal = { create(params) {
			return new CustomModal(app, params);
		} };
	},
	params: { modal: { queueDialogs: true } }
};
Router.use([component_loader_default]);
Framework7.use([
	device_default,
	support_default,
	utils_default,
	resize_default,
	touch_default,
	clicks_default,
	router_default,
	history_default,
	component_default,
	service_worker_default,
	store_default,
	statusbar_default,
	view_default,
	navbar_default,
	toolbar_default,
	subnavbar_default,
	touch_ripple_default,
	modal_default,
	touch_highlight_default
]);
var framework7_esm_default = Framework7;
function noUndefinedProps(obj) {
	const o = {};
	Object.keys(obj).forEach((key) => {
		if (typeof obj[key] !== "undefined") o[key] = obj[key];
	});
	return o;
}
function isStringProp(val) {
	return typeof val === "string" && val !== "";
}
function isObject(o) {
	return typeof o === "object" && o !== null && o.constructor && o.constructor === Object;
}
function now() {
	return Date.now();
}
function extend(...args) {
	let deep = true;
	let to;
	let from;
	if (typeof args[0] === "boolean") {
		[deep, to] = args;
		args.splice(0, 2);
		from = args;
	} else {
		[to] = args;
		args.splice(0, 1);
		from = args;
	}
	for (let i = 0; i < from.length; i += 1) {
		const nextSource = args[i];
		if (nextSource !== void 0 && nextSource !== null) {
			const keysArray = Object.keys(Object(nextSource));
			for (let nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex += 1) {
				const nextKey = keysArray[nextIndex];
				if (nextKey === "__proto__" || nextKey === "constructor" || nextKey === "prototype") continue;
				const desc = Object.getOwnPropertyDescriptor(nextSource, nextKey);
				if (desc !== void 0 && desc.enumerable) {
					if (!deep) to[nextKey] = nextSource[nextKey];
					else if (isObject(to[nextKey]) && isObject(nextSource[nextKey])) extend(to[nextKey], nextSource[nextKey]);
					else if (!isObject(to[nextKey]) && isObject(nextSource[nextKey])) {
						to[nextKey] = {};
						extend(to[nextKey], nextSource[nextKey]);
					} else to[nextKey] = nextSource[nextKey];
				}
			}
		}
	}
	return to;
}
function classNames(...args) {
	const classes = [];
	args.forEach((arg) => {
		if (typeof arg === "object" && arg.constructor === Object) Object.keys(arg).forEach((key) => {
			if (arg[key]) classes.push(key);
		});
		else if (arg) classes.push(arg);
	});
	const uniqueClasses = [];
	classes.forEach((c) => {
		if (uniqueClasses.indexOf(c) < 0) uniqueClasses.push(c);
	});
	return uniqueClasses.join(" ");
}
var routerIdCounter = 0;
var routerComponentIdCounter = 0;
function unsetRouterIds() {
	routerIdCounter = 0;
	routerComponentIdCounter = 0;
}
function getRouterId() {
	routerIdCounter += 1;
	return `${now()}_${routerIdCounter}`;
}
function getComponentId() {
	routerComponentIdCounter += 1;
	return `${now()}_${routerComponentIdCounter}`;
}
function plainText(text) {
	if (typeof text === "undefined" || text === null) return "";
	return text;
}
var f7;
var theme = {};
var app = typeof window !== "undefined" && window.Framework7ComponentsApp ? window.Framework7ComponentsApp : {
	Framework7: void 0,
	f7: void 0,
	f7events: void 0,
	theme: {},
	f7routers: {
		views: [],
		tabs: [],
		modals: null
	}
};
if (typeof window !== "undefined") window.Framework7ComponentsApp = app;
app.setInstance = (instance) => {
	f7 = instance;
};
var setTheme = () => {
	if (!app.f7) return;
	app.theme.ios = app.f7.theme === "ios";
	theme.ios = app.f7.theme === "ios";
	app.theme.md = app.f7.theme === "md";
	theme.md = app.f7.theme === "md";
};
var cleanup = () => {
	unsetRouterIds();
	delete app.theme.ios;
	delete theme.ios;
	delete app.theme.md;
	delete theme.md;
	app.f7routers.views = [];
	app.f7routers.tabs = [];
	app.f7routers.modals = null;
};
var f7initEvents = () => {
	app.f7events = new app.Framework7.Events();
};
var f7init = (rootEl, params = {}, init = true) => {
	const f7Params = extend({}, params, {
		el: rootEl,
		init
	});
	if (typeof params.store !== "undefined") f7Params.store = params.store;
	if (!f7Params.routes) f7Params.routes = [];
	if (f7Params.userAgent && (f7Params.theme === "auto" || !f7Params.theme)) {
		const device = app.Framework7.getDevice({ userAgent: f7Params.userAgent }, true);
		app.theme.ios = !!device.ios;
		app.theme.md = !app.theme.ios;
	}
	if (app.f7 && typeof window !== "undefined") return;
	if (typeof window === "undefined") cleanup();
	const instance = new app.Framework7(f7Params);
	app.f7 = instance;
	f7 = instance;
	app.setInstance(instance);
	setTheme();
	if (instance.initialized) {
		app.f7 = instance;
		f7 = instance;
		app.setInstance(instance);
		app.f7events.emit("ready", app.f7);
	} else instance.on("init", () => {
		app.f7 = instance;
		f7 = instance;
		app.setInstance(instance);
		app.f7events.emit("ready", app.f7);
	});
};
var f7ready = (callback) => {
	if (!callback) return;
	if (app.f7 && app.f7.initialized) callback(app.f7);
	else app.f7events.once("ready", callback);
};
var UNINITIALIZED = Symbol("uninitialized");
var ATTR_REGEX = /[&"<]/g;
var CONTENT_REGEX = /[&<]/g;
/**
* @template V
* @param {V} value
* @param {boolean} [is_attr]
*/
function escape_html(value, is_attr) {
	const str = String(value ?? "");
	const pattern = is_attr ? ATTR_REGEX : CONTENT_REGEX;
	pattern.lastIndex = 0;
	let escaped = "";
	let last = 0;
	while (pattern.test(str)) {
		const i = pattern.lastIndex - 1;
		const ch = str[i];
		escaped += str.substring(last, i) + (ch === "&" ? "&amp;" : ch === "\"" ? "&quot;" : "&lt;");
		last = i + 1;
	}
	return escaped + str.substring(last);
}
function r(e) {
	var t, f, n = "";
	if ("string" == typeof e || "number" == typeof e) n += e;
	else if ("object" == typeof e) if (Array.isArray(e)) {
		var o = e.length;
		for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
	} else for (f in e) e[f] && (n && (n += " "), n += f);
	return n;
}
function clsx$1() {
	for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
	return n;
}
var is_array = Array.isArray;
Array.prototype.indexOf;
Array.prototype.includes;
Array.from;
Array.prototype;
var has_own_property = Object.prototype.hasOwnProperty;
var noop = () => {};
/**
* TODO replace with Promise.withResolvers once supported widely enough
* @template [T=void]
*/
function deferred() {
	/** @type {(value: T) => void} */
	var resolve;
	/** @type {(reason: any) => void} */
	var reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve,
		reject
	};
}
/**
* `<div translate={false}>` should be rendered as `<div translate="no">` and _not_
* `<div translate="false">`, which is equivalent to `<div translate="yes">`. There
* may be other odd cases that need to be added to this list in future
* @type {Record<string, Map<any, string>>}
*/
var replacements = { translate: /* @__PURE__ */ new Map([[true, "yes"], [false, "no"]]) };
/**
* @template V
* @param {string} name
* @param {V} value
* @param {boolean} [is_boolean]
* @returns {string}
*/
function attr(name, value, is_boolean = false) {
	if (name === "hidden" && value !== "until-found") is_boolean = true;
	if (value == null || is_boolean && !value && value !== "") return "";
	const normalized = has_own_property.call(replacements, name) && replacements[name].get(value) || value;
	return ` ${name}${is_boolean ? `=""` : `="${escape_html(normalized, true)}"`}`;
}
/**
* Small wrapper around clsx to preserve Svelte's (weird) handling of falsy values.
* TODO Svelte 6 revisit this, and likely turn all falsy values into the empty string (what clsx also does)
* @param  {any} value
*/
function clsx(value) {
	if (typeof value === "object") return clsx$1(value);
	else return value ?? "";
}
var whitespace = [..." 	\n\r\f\xA0\v﻿"];
/**
* @param {any} value
* @param {string | null} [hash]
* @param {Record<string, boolean>} [directives]
* @returns {string | null}
*/
function to_class(value, hash, directives) {
	var classname = value == null ? "" : "" + value;
	if (hash) classname = classname ? classname + " " + hash : hash;
	if (directives) {
		for (var key of Object.keys(directives)) if (directives[key]) classname = classname ? classname + " " + key : key;
		else if (classname.length) {
			var len = key.length;
			var a = 0;
			while ((a = classname.indexOf(key, a)) >= 0) {
				var b = a + len;
				if ((a === 0 || whitespace.includes(classname[a - 1])) && (b === classname.length || whitespace.includes(classname[b]))) classname = (a === 0 ? "" : classname.substring(0, a)) + classname.substring(b + 1);
				else a = b;
			}
		}
	}
	return classname === "" ? null : classname;
}
/**
*
* @param {Record<string,any>} styles
* @param {boolean} important
*/
function append_styles(styles, important = false) {
	var separator = important ? " !important;" : ";";
	var css = "";
	for (var key of Object.keys(styles)) {
		var value = styles[key];
		if (value != null && value !== "") css += " " + key + ": " + value + separator;
	}
	return css;
}
/**
* @param {string} name
* @returns {string}
*/
function to_css_name(name) {
	if (name[0] !== "-" || name[1] !== "-") return name.toLowerCase();
	return name;
}
/**
* @param {any} value
* @param {Record<string, any> | [Record<string, any>, Record<string, any>]} [styles]
* @returns {string | null}
*/
function to_style(value, styles) {
	if (styles) {
		var new_style = "";
		/** @type {Record<string,any> | undefined} */
		var normal_styles;
		/** @type {Record<string,any> | undefined} */
		var important_styles;
		if (Array.isArray(styles)) {
			normal_styles = styles[0];
			important_styles = styles[1];
		} else normal_styles = styles;
		if (value) {
			value = String(value).replaceAll(/\/\*.*?\*\//g, "").trim();
			/** @type {boolean | '"' | "'"} */
			var in_str = false;
			var in_apo = 0;
			var in_comment = false;
			var reserved_names = [];
			if (normal_styles) reserved_names.push(...Object.keys(normal_styles).map(to_css_name));
			if (important_styles) reserved_names.push(...Object.keys(important_styles).map(to_css_name));
			var start_index = 0;
			var name_index = -1;
			const len = value.length;
			for (var i = 0; i < len; i++) {
				var c = value[i];
				if (in_comment) {
					if (c === "/" && value[i - 1] === "*") in_comment = false;
				} else if (in_str) {
					if (in_str === c) in_str = false;
				} else if (c === "/" && value[i + 1] === "*") in_comment = true;
				else if (c === "\"" || c === "'") in_str = c;
				else if (c === "(") in_apo++;
				else if (c === ")") in_apo--;
				if (!in_comment && in_str === false && in_apo === 0) {
					if (c === ":" && name_index === -1) name_index = i;
					else if (c === ";" || i === len - 1) {
						if (name_index !== -1) {
							var name = to_css_name(value.substring(start_index, name_index).trim());
							if (!reserved_names.includes(name)) {
								if (c !== ";") i++;
								var property = value.substring(start_index, i).trim();
								new_style += " " + property + ";";
							}
						}
						start_index = i + 1;
						name_index = -1;
					}
				}
			}
		}
		if (normal_styles) new_style += append_styles(normal_styles);
		if (important_styles) new_style += append_styles(important_styles, true);
		new_style = new_style.trim();
		return new_style === "" ? null : new_style;
	}
	return value == null ? null : String(value);
}
/** allow users to ignore aborted signal errors if `reason.name === 'StaleReactionError` */
var STALE_REACTION = new class StaleReactionError extends Error {
	name = "StaleReactionError";
	message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}();
globalThis.document?.contentType;
/**
* `%name%(...)` can only be used during component initialisation
* @param {string} name
* @returns {never}
*/
function lifecycle_outside_component(name) {
	throw new Error(`https://svelte.dev/e/lifecycle_outside_component`);
}
/**
* `setContext` must be called when a component first initializes, not in a subsequent effect or after an `await` expression
* @returns {never}
*/
function set_context_after_init() {
	throw new Error(`https://svelte.dev/e/set_context_after_init`);
}
/** True if experimental.async=true */
var async_mode_flag = false;
/**
* @typedef {{ p: Context | null, c: Map<unknown, unknown> | null }} Context
*/
/**
* @param {Context} context
* @returns {Map<unknown, unknown> | null}
*/
function get_parent_context(context) {
	let parent = context.p;
	while (parent !== null && parent.c === null) parent = parent.p;
	return parent?.c ?? null;
}
/**
* @param {Context | null} context
* @param {string} name
* @returns {Map<unknown, unknown>}
*/
function get_or_init_context_map(context, name) {
	if (context === null) lifecycle_outside_component(name);
	return context.c ??= new Map(get_parent_context(context) || void 0);
}
var BLOCK_OPEN = `<!--[-->`;
var BLOCK_CLOSE = `<!--]-->`;
/**
* Attributes that are boolean, i.e. they are present or not present.
*/
var DOM_BOOLEAN_ATTRIBUTES = [
	"allowfullscreen",
	"async",
	"autofocus",
	"autoplay",
	"checked",
	"controls",
	"default",
	"disabled",
	"formnovalidate",
	"indeterminate",
	"inert",
	"ismap",
	"loop",
	"multiple",
	"muted",
	"nomodule",
	"novalidate",
	"open",
	"playsinline",
	"readonly",
	"required",
	"reversed",
	"seamless",
	"selected",
	"webkitdirectory",
	"defer",
	"disablepictureinpicture",
	"disableremoteplayback"
];
/**
* Returns `true` if `name` is a boolean attribute
* @param {string} name
*/
function is_boolean_attribute(name) {
	return DOM_BOOLEAN_ATTRIBUTES.includes(name);
}
[...DOM_BOOLEAN_ATTRIBUTES];
/**
* The node API `AsyncLocalStorage` is not available, but is required to use async server rendering.
* @returns {never}
*/
function async_local_storage_unavailable() {
	const error = /* @__PURE__ */ new Error(`async_local_storage_unavailable\nThe node API \`AsyncLocalStorage\` is not available, but is required to use async server rendering.\nhttps://svelte.dev/e/async_local_storage_unavailable`);
	error.name = "Svelte error";
	throw error;
}
/**
* Encountered asynchronous work while rendering synchronously.
* @returns {never}
*/
function await_invalid() {
	const error = /* @__PURE__ */ new Error(`await_invalid\nEncountered asynchronous work while rendering synchronously.\nhttps://svelte.dev/e/await_invalid`);
	error.name = "Svelte error";
	throw error;
}
/**
* The `html` property of server render results has been deprecated. Use `body` instead.
* @returns {never}
*/
function html_deprecated() {
	const error = /* @__PURE__ */ new Error(`html_deprecated\nThe \`html\` property of server render results has been deprecated. Use \`body\` instead.\nhttps://svelte.dev/e/html_deprecated`);
	error.name = "Svelte error";
	throw error;
}
/**
* `csp.nonce` was set while `csp.hash` was `true`. These options cannot be used simultaneously.
* @returns {never}
*/
function invalid_csp() {
	const error = /* @__PURE__ */ new Error(`invalid_csp\n\`csp.nonce\` was set while \`csp.hash\` was \`true\`. These options cannot be used simultaneously.\nhttps://svelte.dev/e/invalid_csp`);
	error.name = "Svelte error";
	throw error;
}
/**
* The `idPrefix` option cannot include `--`.
* @returns {never}
*/
function invalid_id_prefix() {
	const error = /* @__PURE__ */ new Error(`invalid_id_prefix\nThe \`idPrefix\` option cannot include \`--\`.\nhttps://svelte.dev/e/invalid_id_prefix`);
	error.name = "Svelte error";
	throw error;
}
/**
* Could not resolve `render` context.
* @returns {never}
*/
function server_context_required() {
	const error = /* @__PURE__ */ new Error(`server_context_required\nCould not resolve \`render\` context.\nhttps://svelte.dev/e/server_context_required`);
	error.name = "Svelte error";
	throw error;
}
/** @import { SSRContext } from '#server' */
/** @type {SSRContext | null} */
var ssr_context = null;
/** @param {SSRContext | null} v */
function set_ssr_context(v) {
	ssr_context = v;
}
/**
* @template T
* @param {any} key
* @returns {T}
*/
function getContext(key) {
	return get_or_init_context_map(ssr_context, "getContext").get(key);
}
/**
* @template T
* @param {any} key
* @param {T} context
* @returns {T}
*/
function setContext(key, context) {
	const context_map = get_or_init_context_map(ssr_context, "setContext");
	if (ssr_context.i) set_context_after_init();
	context_map.set(key, context);
	return context;
}
/**
* @param {Function} [fn]
*/
function push(fn) {
	ssr_context = {
		p: ssr_context,
		c: null,
		r: null,
		i: false
	};
}
function pop() {
	ssr_context = ssr_context.p;
}
/**
* A `hydratable` value with key `%key%` was created, but at least part of it was not used during the render.
* 
* The `hydratable` was initialized in:
* %stack%
* @param {string} key
* @param {string} stack
*/
function unresolved_hydratable(key, stack) {
	console.warn(`https://svelte.dev/e/unresolved_hydratable`);
}
/** @import { AsyncLocalStorage } from 'node:async_hooks' */
/** @import { RenderContext } from '#server' */
/** @type {Promise<void> | null} */
var current_render = null;
/** @type {RenderContext | null} */
var context = null;
/** @returns {RenderContext} */
function get_render_context() {
	const store = context ?? als?.getStore();
	if (!store) server_context_required();
	return store;
}
/**
* @template T
* @param {() => Promise<T>} fn
* @returns {Promise<T>}
*/
async function with_render_context(fn) {
	context = { hydratable: {
		lookup: /* @__PURE__ */ new Map(),
		comparisons: [],
		unresolved_promises: /* @__PURE__ */ new Map()
	} };
	if (in_webcontainer()) {
		const { promise, resolve } = deferred();
		const previous_render = current_render;
		current_render = promise;
		await previous_render;
		return fn().finally(resolve);
	}
	try {
		if (als === null) async_local_storage_unavailable();
		return als.run(context, fn);
	} finally {
		context = null;
	}
}
/** @type {AsyncLocalStorage<RenderContext | null> | null} */
var als = null;
/** @type {Promise<void> | null} */
var als_import = null;
/**
*
* @returns {Promise<void>}
*/
function init_render_context() {
	als_import ??= import("node:async_hooks").then((hooks) => {
		als = new hooks.AsyncLocalStorage();
	}).then(noop, noop);
	return als_import;
}
function in_webcontainer() {
	return !!globalThis.process?.versions?.webcontainer;
}
var text_encoder;
var crypto$1;
/** @param {string} module_name */
var obfuscated_import = (module_name) => import(
	/* @vite-ignore */
	module_name
);
/** @param {string} data */
async function sha256(data) {
	text_encoder ??= new TextEncoder();
	crypto$1 ??= globalThis.crypto?.subtle?.digest ? globalThis.crypto : (await obfuscated_import("node:crypto")).webcrypto;
	return base64_encode(await crypto$1.subtle.digest("SHA-256", text_encoder.encode(data)));
}
/**
* @param {Uint8Array} bytes
* @returns {string}
*/
function base64_encode(bytes) {
	if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString("base64");
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}
var MAX_ARRAY_INDEX = 2 ** 32 - 1 - 1;
/** @type {Record<string, string>} */
var escaped = {
	"<": "\\u003C",
	"\\": "\\\\",
	"\b": "\\b",
	"\f": "\\f",
	"\n": "\\n",
	"\r": "\\r",
	"	": "\\t",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029"
};
var DevalueError = class extends Error {
	/**
	* @param {string} message
	* @param {string[]} keys
	* @param {any} [value] - The value that failed to be serialized
	* @param {any} [root] - The root value being serialized
	*/
	constructor(message, keys, value, root) {
		super(message);
		this.name = "DevalueError";
		this.path = keys.join("");
		this.value = value;
		this.root = root;
	}
};
/** @param {any} thing */
function is_primitive(thing) {
	return thing === null || typeof thing !== "object" && typeof thing !== "function";
}
var object_proto_names = /* @__PURE__ */ Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
/** @param {any} thing */
function is_plain_object(thing) {
	const proto = Object.getPrototypeOf(thing);
	return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto) === null || Object.getOwnPropertyNames(proto).sort().join("\0") === object_proto_names;
}
/** @param {any} thing */
function get_type(thing) {
	return Object.prototype.toString.call(thing).slice(8, -1);
}
/** @param {any} thing */
function is_buffer(thing) {
	return typeof Buffer !== "undefined" && Buffer.isBuffer(thing);
}
/** @param {string} char */
function get_escaped_char(char) {
	switch (char) {
		case "\"": return "\\\"";
		case "<": return "\\u003C";
		case "\\": return "\\\\";
		case "\n": return "\\n";
		case "\r": return "\\r";
		case "	": return "\\t";
		case "\b": return "\\b";
		case "\f": return "\\f";
		case "\u2028": return "\\u2028";
		case "\u2029": return "\\u2029";
		default: return char < " " ? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}` : "";
	}
}
/** @param {string} str */
function stringify_string(str) {
	let result = "";
	let last_pos = 0;
	const len = str.length;
	for (let i = 0; i < len; i += 1) {
		const char = str[i];
		const replacement = get_escaped_char(char);
		if (replacement) {
			result += str.slice(last_pos, i) + replacement;
			last_pos = i + 1;
		}
	}
	return `"${last_pos === 0 ? str : result + str.slice(last_pos)}"`;
}
/** @param {Record<string | symbol, any>} object */
function enumerable_symbols(object) {
	return Object.getOwnPropertySymbols(object).filter((symbol) => Object.getOwnPropertyDescriptor(object, symbol).enumerable);
}
var is_identifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;
/** @param {string} key */
function stringify_key(key) {
	return is_identifier.test(key) ? "." + key : "[" + JSON.stringify(key) + "]";
}
/** @param {number} n */
function is_valid_array_index(n) {
	if (!Number.isInteger(n)) return false;
	if (n < 0) return false;
	if (n > MAX_ARRAY_INDEX) return false;
	return true;
}
/** @param {string} s */
function is_valid_array_index_string(s) {
	if (s.length === 0) return false;
	if (s.length > 1 && s.charCodeAt(0) === 48) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	return is_valid_array_index(+s);
}
/**
* Returns the length of the leading run of valid array indices in `keys`.
* @param {readonly string[]} keys
*/
function array_index_cut(keys) {
	for (var i = keys.length - 1; i >= 0; i--) if (is_valid_array_index_string(keys[i])) break;
	return i + 1;
}
/**
* Finds the populated indices of an array.
* @param {unknown[]} array
*/
function valid_array_indices(array) {
	const keys = Object.keys(array);
	keys.length = array_index_cut(keys);
	return keys;
}
var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
var MIN_STRING_LENGTH = 128;
var unsafe_chars = /[<\b\f\n\r\t\0\u2028\u2029]/g;
var reserved = /^(?:do|if|in|for|int|let|new|try|var|byte|case|char|else|enum|goto|long|this|void|with|await|break|catch|class|const|final|float|short|super|throw|while|yield|delete|double|export|import|native|return|switch|throws|typeof|boolean|default|extends|finally|package|private|abstract|continue|debugger|function|volatile|interface|protected|transient|implements|instanceof|synchronized)$/;
/**
* Turn a value into the JavaScript that creates an equivalent value
* @param {any} value
* @param {(value: any, uneval: (value: any) => string) => string | void} [replacer]
*/
function uneval(value, replacer) {
	const counts = /* @__PURE__ */ new Map();
	/** @type {string[]} */
	const keys = [];
	const custom = /* @__PURE__ */ new Map();
	/** @type {Map<string | bigint, string> | undefined} */
	let primitives;
	/** @param {any} thing */
	function stringify_cached_primitive(thing) {
		if (typeof thing === "string" && thing.length >= MIN_STRING_LENGTH || typeof thing === "bigint") {
			primitives ??= /* @__PURE__ */ new Map();
			let literal = primitives.get(thing);
			if (literal === void 0) {
				literal = stringify_primitive(thing);
				primitives.set(thing, literal);
			}
			return literal;
		}
		return stringify_primitive(thing);
	}
	/** @param {any} thing */
	function walk(thing) {
		if (!is_primitive(thing)) {
			if (counts.has(thing)) {
				counts.set(thing, counts.get(thing) + 1);
				return;
			}
			counts.set(thing, 1);
			if (replacer) {
				const str = replacer(thing, (value) => uneval(value, replacer));
				if (typeof str === "string") {
					custom.set(thing, str);
					return;
				}
			}
			if (typeof thing === "function") throw new DevalueError(`Cannot stringify a function`, keys, thing, value);
			switch (get_type(thing)) {
				case "BigInt":
				case "String":
					walk(thing.valueOf());
					return;
				case "Number":
				case "Boolean":
				case "Date":
				case "RegExp":
				case "URL":
				case "URLSearchParams": return;
				case "Array":
					for (const i of valid_array_indices(thing)) {
						keys.push(`[${i}]`);
						walk(thing[i]);
						keys.pop();
					}
					break;
				case "Set":
					Array.from(thing).forEach(walk);
					break;
				case "Map":
					for (const [key, value] of thing) {
						keys.push(`.get(${is_primitive(key) ? stringify_cached_primitive(key) : "..."})`);
						walk(key);
						walk(value);
						keys.pop();
					}
					break;
				case "Int8Array":
				case "Uint8Array":
				case "Uint8ClampedArray":
				case "Int16Array":
				case "Uint16Array":
				case "Float16Array":
				case "Int32Array":
				case "Uint32Array":
				case "Float32Array":
				case "Float64Array":
				case "BigInt64Array":
				case "BigUint64Array":
				case "DataView":
					if (!is_buffer(thing)) walk(thing.buffer);
					return;
				case "ArrayBuffer": return;
				case "Temporal.Duration":
				case "Temporal.Instant":
				case "Temporal.PlainDate":
				case "Temporal.PlainTime":
				case "Temporal.PlainDateTime":
				case "Temporal.PlainMonthDay":
				case "Temporal.PlainYearMonth":
				case "Temporal.ZonedDateTime": return;
				default:
					if (!is_plain_object(thing)) throw new DevalueError(`Cannot stringify arbitrary non-POJOs`, keys, thing, value);
					if (enumerable_symbols(thing).length > 0) throw new DevalueError(`Cannot stringify POJOs with symbolic keys`, keys, thing, value);
					for (const key of Object.keys(thing)) {
						if (key === "__proto__") throw new DevalueError(`Cannot stringify objects with __proto__ keys`, keys, thing, value);
						keys.push(stringify_key(key));
						walk(thing[key]);
						keys.pop();
					}
			}
		} else if (typeof thing === "symbol") throw new DevalueError(`Cannot stringify a Symbol primitive`, keys, thing, value);
		else if (typeof thing === "string" && thing.length >= MIN_STRING_LENGTH || typeof thing === "bigint") counts.set(thing, (counts.get(thing) || 0) + 1);
	}
	walk(value);
	const names = /* @__PURE__ */ new Map();
	/** @type {Array<[any, number]>} */
	const repeated = [];
	counts.forEach((count, thing) => {
		if (count > 1) repeated.push([thing, count]);
	});
	repeated.sort((a, b) => b[1] - a[1]).forEach(([thing, count]) => {
		const name = get_name(names.size);
		if (is_primitive(thing)) {
			const length = stringify_cached_primitive(thing).length;
			if (length * count <= length + (count + 1) * name.length + 25) return;
		}
		names.set(thing, name);
	});
	/**
	* @param {any} thing
	* @returns {string}
	*/
	function stringify(thing) {
		if (names.has(thing)) return names.get(thing);
		if (is_primitive(thing)) return stringify_primitive(thing);
		if (custom.has(thing)) return custom.get(thing);
		const type = get_type(thing);
		switch (type) {
			case "Number":
			case "String":
			case "Boolean":
			case "BigInt": return `Object(${stringify(thing.valueOf())})`;
			case "RegExp":
				const { source, flags } = thing;
				return flags ? `new RegExp(${stringify_string(source)},"${flags}")` : `new RegExp(${stringify_string(source)})`;
			case "Date": return `new Date(${thing.getTime()})`;
			case "URL": return `new URL(${stringify_string(thing.toString())})`;
			case "URLSearchParams": return `new URLSearchParams(${stringify_string(thing.toString())})`;
			case "Array": {
				let has_holes = false;
				let result = "[";
				for (let i = 0; i < thing.length; i += 1) {
					if (i > 0) result += ",";
					if (Object.hasOwn(thing, i)) result += stringify(thing[i]);
					else if (!has_holes) {
						const populated_keys = valid_array_indices(thing);
						const population = populated_keys.length;
						const d = String(thing.length).length;
						const array = stringify_sparse_array(thing.length);
						if (thing.length + 2 > array.length + 18 + population * (d + 2)) return `Object.assign(${array},{${populated_keys.map((k) => `${k}:${stringify(thing[k])}`).join(",")}})`;
						has_holes = true;
					}
				}
				const tail = thing.length === 0 || Object.hasOwn(thing, thing.length - 1) ? "" : ",";
				return result + tail + "]";
			}
			case "Set":
			case "Map": return `new ${type}([${Array.from(thing).map(stringify).join(",")}])`;
			case "Int8Array":
			case "Uint8Array":
			case "Uint8ClampedArray":
			case "Int16Array":
			case "Uint16Array":
			case "Float16Array":
			case "Int32Array":
			case "Uint32Array":
			case "Float32Array":
			case "Float64Array":
			case "BigInt64Array":
			case "BigUint64Array": {
				if (is_buffer(thing)) thing = new Uint8Array(thing);
				let str = `new ${type}`;
				if (!names.has(thing.buffer)) str += `([${stringify_typed_array_elements(type, thing.buffer)}])`;
				else str += `(${stringify(thing.buffer)})`;
				if (thing.byteLength !== thing.buffer.byteLength) {
					const start = thing.byteOffset / thing.BYTES_PER_ELEMENT;
					const end = start + thing.length;
					str += `.subarray(${start},${end})`;
				}
				return str;
			}
			case "DataView": {
				let str = `new DataView`;
				if (!names.has(thing.buffer)) str += `(new Uint8Array([${new Uint8Array(thing.buffer)}]).buffer`;
				else str += `(${stringify(thing.buffer)}`;
				if (thing.byteLength !== thing.buffer.byteLength) str += `,${thing.byteOffset},${thing.byteLength}`;
				return str + ")";
			}
			case "ArrayBuffer": return `new Uint8Array([${new Uint8Array(thing).toString()}]).buffer`;
			case "Temporal.Duration":
			case "Temporal.Instant":
			case "Temporal.PlainDate":
			case "Temporal.PlainTime":
			case "Temporal.PlainDateTime":
			case "Temporal.PlainMonthDay":
			case "Temporal.PlainYearMonth":
			case "Temporal.ZonedDateTime": return `${type}.from(${stringify_string(thing.toString())})`;
			default:
				const keys = Object.keys(thing);
				const obj = keys.map((key) => `${safe_key(key)}:${stringify(thing[key])}`).join(",");
				if (Object.getPrototypeOf(thing) === null) return keys.length > 0 ? `{${obj},__proto__:null}` : `{__proto__:null}`;
				return `{${obj}}`;
		}
	}
	const str = stringify(value);
	if (names.size) {
		/** @type {string[]} */
		const params = [];
		/** @type {string[]} */
		const statements = [];
		/** @type {string[]} */
		const values = [];
		/** @type {string[]} */
		const reconstructions = [];
		names.forEach((name, thing) => {
			params.push(name);
			if (custom.has(thing)) {
				values.push(custom.get(thing));
				return;
			}
			if (is_primitive(thing)) {
				values.push(stringify_cached_primitive(thing));
				return;
			}
			const type = get_type(thing);
			switch (type) {
				case "Number":
				case "String":
				case "Boolean":
				case "BigInt": {
					const primitive = thing.valueOf();
					if (names.has(primitive)) {
						values.push("{}");
						reconstructions.push(`${name}=Object(${stringify(primitive)})`);
					} else values.push(`Object(${stringify(primitive)})`);
					break;
				}
				case "RegExp":
					const { source, flags } = thing;
					const regexp = flags ? `new RegExp(${stringify_string(source)},"${flags}")` : `new RegExp(${stringify_string(source)})`;
					values.push(regexp);
					break;
				case "Date":
					values.push(`new Date(${thing.getTime()})`);
					break;
				case "URL":
					values.push(`new URL(${stringify_string(thing.toString())})`);
					break;
				case "URLSearchParams":
					values.push(`new URLSearchParams(${stringify_string(thing.toString())})`);
					break;
				case "Array": {
					const populated_keys = valid_array_indices(thing);
					values.push(thing.length > 32 + 2 * populated_keys.length ? stringify_sparse_array(thing.length) : `Array(${thing.length})`);
					for (const i of populated_keys) statements.push(`${name}[${i}]=${stringify(thing[i])}`);
					break;
				}
				case "Set": {
					values.push(`new Set`);
					const adds = Array.from(thing).map((v) => `.add(${stringify(v)})`);
					if (adds.length > 0) statements.push(name + adds.join(""));
					break;
				}
				case "Map": {
					values.push(`new Map`);
					const sets = Array.from(thing).map(([k, v]) => `.set(${stringify(k)}, ${stringify(v)})`);
					if (sets.length > 0) statements.push(name + sets.join(""));
					break;
				}
				case "Int8Array":
				case "Uint8Array":
				case "Uint8ClampedArray":
				case "Int16Array":
				case "Uint16Array":
				case "Float16Array":
				case "Int32Array":
				case "Uint32Array":
				case "Float32Array":
				case "Float64Array":
				case "BigInt64Array":
				case "BigUint64Array": {
					if (is_buffer(thing)) thing = new Uint8Array(thing);
					let str = `new ${type}`;
					if (!names.has(thing.buffer)) str += `([${stringify_typed_array_elements(type, thing.buffer)}])`;
					else str += `(${stringify(thing.buffer)})`;
					if (thing.byteLength !== thing.buffer.byteLength) {
						const start = thing.byteOffset / thing.BYTES_PER_ELEMENT;
						const end = start + thing.length;
						str += `.subarray(${start},${end})`;
					}
					values.push(`{}`);
					reconstructions.push(`${name}=${str}`);
					break;
				}
				case "DataView": {
					let str = `new DataView`;
					if (!names.has(thing.buffer)) str += `(new Uint8Array([${new Uint8Array(thing.buffer)}]).buffer`;
					else str += `(${stringify(thing.buffer)}`;
					if (thing.byteLength !== thing.buffer.byteLength) str += `,${thing.byteOffset},${thing.byteLength}`;
					str += ")";
					values.push(`{}`);
					reconstructions.push(`${name}=${str}`);
					break;
				}
				case "ArrayBuffer":
					values.push(`new Uint8Array([${new Uint8Array(thing)}]).buffer`);
					break;
				case "Temporal.Duration":
				case "Temporal.Instant":
				case "Temporal.PlainDate":
				case "Temporal.PlainTime":
				case "Temporal.PlainDateTime":
				case "Temporal.PlainMonthDay":
				case "Temporal.PlainYearMonth":
				case "Temporal.ZonedDateTime":
					values.push(`${type}.from(${stringify_string(thing.toString())})`);
					break;
				default:
					values.push(Object.getPrototypeOf(thing) === null ? "Object.create(null)" : "{}");
					Object.keys(thing).forEach((key) => {
						statements.push(`${name}${safe_prop(key)}=${stringify(thing[key])}`);
					});
			}
		});
		statements.push(`return ${str}`);
		const body = [...reconstructions, ...statements].join(";");
		if (params.length > 65534) return `(function(){var[${params.join(",")}]=arguments[0];${body}}([${values.join(",")}]))`;
		return `(function(${params.join(",")}){${body}}(${values.join(",")}))`;
	} else return str;
}
/**
* Emit an array whose storage is not proportional to its declared length.
* As in the default parse operations, touching and deleting the largest valid
* index forces V8 into dictionary-elements mode before setting the length.
* Merely starting with [] and assigning .length still eagerly allocates.
* @param {number} length
*/
function stringify_sparse_array(length) {
	return `(function(a){a[${MAX_ARRAY_INDEX}]=0;delete a[${MAX_ARRAY_INDEX}];a.length=${length};return a}([]))`;
}
/**
* Serialize the elements of `buffer`, read as `type`, as a comma-separated list.
* The view is created from `type` rather than from the serialized value's own
* constructor, which may be a subclass like Node's `Buffer` whose `toString`
* decodes the bytes instead of listing them.
* `BigInt64Array`/`BigUint64Array` elements are bigints and must be written
* with an `n` suffix, otherwise the emitted `new BigInt64Array([...])` throws.
* @param {string} type
* @param {ArrayBufferLike} buffer
*/
function stringify_typed_array_elements(type, buffer) {
	const array = new globalThis[type](buffer);
	if (type === "BigInt64Array" || type === "BigUint64Array") return Array.from(array, (element) => `${element}n`).join(",");
	if (array instanceof Float32Array || array instanceof Float64Array || typeof Float16Array !== "undefined" && array instanceof Float16Array) return Array.from(array, (element) => Object.is(element, -0) ? "-0" : `${element}`).join(",");
	return array.toString();
}
/** @param {number} num */
function get_name(num) {
	let name = "";
	do {
		name = chars[num % 54] + name;
		num = ~~(num / 54) - 1;
	} while (num >= 0);
	return reserved.test(name) ? `${name}0` : name;
}
/** @param {string} c */
function escape_unsafe_char(c) {
	return escaped[c] || c;
}
/** @param {string} str */
function escape_unsafe_chars(str) {
	return str.replace(unsafe_chars, escape_unsafe_char);
}
/** @param {string} key */
function safe_key(key) {
	return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? key : escape_unsafe_chars(JSON.stringify(key));
}
/** @param {string} key */
function safe_prop(key) {
	return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? `.${key}` : `[${escape_unsafe_chars(JSON.stringify(key))}]`;
}
/** @param {any} thing */
function stringify_primitive(thing) {
	const type = typeof thing;
	if (type === "string") return stringify_string(thing);
	if (thing === void 0) return "void 0";
	if (thing === 0 && 1 / thing < 0) return "-0";
	const str = String(thing);
	if (type === "number") return str.replace(/^(-)?0\./, "$1.");
	if (type === "bigint") return thing + "n";
	return str;
}
/** @import { Component } from 'svelte' */
/** @import { HydratableContext, SSRContext } from './types.js' */
/** @import { Csp, RenderOutput, SyncRenderOutput, Sha256Source } from '../../server/public.js' */
/** @import { MaybePromise } from '#shared' */
/** @typedef {'head' | 'body'} RendererType */
/** @typedef {{ [key in RendererType]: string }} AccumulatedContent */
/**
* @typedef {string | Renderer} RendererItem
*/
var RenderResult = class {
	/** @type {() => AccumulatedContent} */
	#render;
	/** @type {() => Promise<AccumulatedContent & { hashes: { script: Sha256Source[] } }>} */
	#render_async;
	/** @type {AccumulatedContent | undefined} */
	#sync;
	/** @type {{ script: '' }} */
	#hashes = { script: "" };
	/** @type {Promise<AccumulatedContent & { hashes: { script: Sha256Source[] } }> | undefined} */
	#promise;
	/**
	* @param {() => AccumulatedContent} render
	* @param {() => Promise<AccumulatedContent & { hashes: { script: Sha256Source[] } }>} render_async
	*/
	constructor(render, render_async) {
		this.#render = render;
		this.#render_async = render_async;
	}
	#get() {
		return this.#sync ??= this.#render();
	}
	get html() {
		return this.#get().body;
	}
	get head() {
		return this.#get().head;
	}
	get body() {
		return this.#get().body;
	}
	get hashes() {
		return this.#hashes;
	}
	/**
	* This is not type-safe, but honestly it's the best I can do right now, and it's a straightforward function.
	*
	* @template TResult1
	* @template [TResult2=never]
	* @param {(value: SyncRenderOutput) => TResult1} onfulfilled
	* @param {(reason: unknown) => TResult2} onrejected
	*/
	then(onfulfilled, onrejected) {
		if (!async_mode_flag) {
			const result = this.#get();
			const user_result = onfulfilled({
				head: result.head,
				body: result.body,
				html: result.body,
				hashes: { script: [] }
			});
			return Promise.resolve(user_result);
		}
		this.#promise ??= this.#render_async().then((result) => {
			Object.defineProperty(result, "html", { get: () => {
				html_deprecated();
			} });
			return result;
		});
		return this.#promise.then((result) => onfulfilled(result), onrejected);
	}
};
/**
* Renderers are basically a tree of `string | Renderer`s, where each `Renderer` in the tree represents
* work that may or may not have completed. A renderer can be {@link collect}ed to aggregate the
* content from itself and all of its children, but this will throw if any of the children are
* performing asynchronous work. To asynchronously collect a renderer, just `await` it.
*
* The `string` values within a renderer are always associated with the {@link type} of that renderer. To switch types,
* call {@link child} with a different `type` argument.
*/
var Renderer = class Renderer {
	/**
	* The contents of the renderer.
	* @type {RendererItem[]}
	*/
	#out = [];
	/**
	* Any `onDestroy` callbacks registered during execution of this renderer.
	* @type {(() => void)[] | undefined}
	*/
	#on_destroy = void 0;
	/**
	* Whether this renderer is a component body.
	* @type {boolean}
	*/
	#is_component_body = false;
	/**
	* If set, this renderer is an error boundary. When async collection
	* of the children fails, the failed snippet is rendered instead.
	* @type {{
	* 	failed: (renderer: Renderer, error: unknown, reset: () => void) => void;
	* 	transformError: (error: unknown) => unknown;
	* 	context: SSRContext | null;
	* } | null}
	*/
	#boundary = null;
	/**
	* The type of string content that this renderer is accumulating.
	* @type {RendererType}
	*/
	type;
	/** @type {Renderer | undefined} */
	#parent;
	/**
	* Asynchronous work associated with this renderer
	* @type {Promise<void> | undefined}
	*/
	promise = void 0;
	/**
	* State which is associated with the content tree as a whole.
	* It will be re-exposed, uncopied, on all children.
	* @type {SSRState}
	* @readonly
	*/
	global;
	/**
	* State that is local to the branch it is declared in.
	* It will be shallow-copied to all children.
	*
	* @type {{ select_value: any, multiple: boolean }}
	*/
	local;
	/**
	* @param {SSRState} global
	* @param {Renderer | undefined} [parent]
	*/
	constructor(global, parent) {
		this.#parent = parent;
		this.global = global;
		this.local = parent ? { ...parent.local } : {
			select_value: void 0,
			multiple: false
		};
		this.type = parent ? parent.type : "body";
	}
	/**
	* @param {(renderer: Renderer) => void} fn
	*/
	head(fn) {
		const head = new Renderer(this.global, this);
		head.type = "head";
		this.#out.push(head);
		head.child(fn);
	}
	/**
	* @param {Array<Promise<void>>} blockers
	* @param {(renderer: Renderer) => void} fn
	*/
	async_block(blockers, fn) {
		this.#out.push(BLOCK_OPEN);
		this.async(blockers, fn);
		this.#out.push(BLOCK_CLOSE);
	}
	/**
	* @param {Array<Promise<void>>} blockers
	* @param {(renderer: Renderer) => void} fn
	*/
	async(blockers, fn) {
		let callback = fn;
		if (blockers.length > 0) {
			const context = ssr_context;
			callback = (renderer) => {
				return Promise.all(blockers).then(() => {
					const previous_context = ssr_context;
					try {
						set_ssr_context(context);
						return fn(renderer);
					} finally {
						set_ssr_context(previous_context);
					}
				});
			};
		}
		this.child(callback);
	}
	/**
	* @param {Array<() => void>} thunks
	*/
	run(thunks) {
		const context = ssr_context;
		let promise = Promise.resolve(thunks[0]());
		const promises = [promise];
		if (context !== null && thunks.length > 1) context.i = true;
		for (const fn of thunks.slice(1)) {
			promise = promise.then(() => {
				const previous_context = ssr_context;
				set_ssr_context(context);
				try {
					return fn();
				} finally {
					set_ssr_context(previous_context);
				}
			});
			promises.push(promise);
		}
		promise.catch(noop);
		this.promise = this.global.track(promise);
		return promises;
	}
	/**
	* @param {(renderer: Renderer) => MaybePromise<void>} fn
	*/
	child_block(fn) {
		this.#out.push(BLOCK_OPEN);
		this.child(fn);
		this.#out.push(BLOCK_CLOSE);
	}
	/**
	* Create a child renderer. The child renderer inherits the state from the parent,
	* but has its own content.
	* @param {(renderer: Renderer) => MaybePromise<void>} fn
	*/
	child(fn) {
		const child = new Renderer(this.global, this);
		this.#out.push(child);
		const parent = ssr_context;
		set_ssr_context({
			...ssr_context,
			p: parent,
			c: null,
			r: child,
			i: ssr_context?.i ?? false
		});
		const result = fn(child);
		set_ssr_context(parent);
		if (result instanceof Promise) {
			result.catch(noop);
			result.finally(() => set_ssr_context(null)).catch(noop);
			if (child.global.mode === "sync") await_invalid();
			child.promise = child.global.track(result);
		}
		return child;
	}
	/**
	* Render children inside an error boundary. If the children throw and the API-level
	* `transformError` transform handles the error (doesn't re-throw), the `failed` snippet is
	* rendered instead. Otherwise the error propagates.
	*
	* @param {{ failed?: (renderer: Renderer, error: unknown, reset: () => void) => void }} props
	* @param {(renderer: Renderer) => MaybePromise<void>} children_fn
	*/
	boundary(props, children_fn) {
		const child = new Renderer(this.global, this);
		this.#out.push(child);
		const parent_context = ssr_context;
		if (props.failed) child.#boundary = {
			failed: props.failed,
			transformError: this.global.transformError,
			context: parent_context
		};
		set_ssr_context({
			...ssr_context,
			p: parent_context,
			c: null,
			r: child,
			i: ssr_context?.i ?? false
		});
		try {
			const result = children_fn(child);
			set_ssr_context(parent_context);
			if (result instanceof Promise) {
				if (child.global.mode === "sync") await_invalid();
				result.catch(noop);
				child.promise = child.global.track(result);
			}
		} catch (error) {
			set_ssr_context(parent_context);
			const failed_snippet = props.failed;
			if (!failed_snippet) throw error;
			const result = this.global.transformError(error);
			child.#out.length = 0;
			child.#boundary = null;
			if (result instanceof Promise) {
				if (this.global.mode === "sync") await_invalid();
				child.promise = child.global.track(
					/** @type {Promise<unknown>} */
					result.then((transformed) => {
						set_ssr_context(parent_context);
						child.#out.push(Renderer.#serialize_failed_boundary(transformed));
						failed_snippet(child, transformed, noop);
						child.#out.push(BLOCK_CLOSE);
					})
				);
				child.promise.catch(noop);
			} else {
				child.#out.push(Renderer.#serialize_failed_boundary(result));
				failed_snippet(child, result, noop);
				child.#out.push(BLOCK_CLOSE);
			}
		}
	}
	/**
	* Create a component renderer. The component renderer inherits the state from the parent,
	* but has its own content. It is treated as an ordering boundary for ondestroy callbacks.
	* @param {(renderer: Renderer) => MaybePromise<void>} fn
	* @param {Function} [component_fn]
	* @returns {void}
	*/
	component(fn, component_fn) {
		push(component_fn);
		this.child((renderer) => {
			renderer.#is_component_body = true;
			return fn(renderer);
		});
		pop();
	}
	/**
	* @param {Record<string, any>} attrs
	* @param {(renderer: Renderer) => void} fn
	* @param {string | undefined} [css_hash]
	* @param {Record<string, boolean> | undefined} [classes]
	* @param {Record<string, string> | undefined} [styles]
	* @param {number | undefined} [flags]
	* @param {boolean | undefined} [is_rich]
	* @returns {void}
	*/
	select(attrs, fn, css_hash, classes, styles, flags, is_rich) {
		const { value, defaultValue, ...select_attrs } = attrs;
		if (select_attrs.multiple === "") select_attrs.multiple = true;
		this.push(`<select${attributes(select_attrs, css_hash, classes, styles, flags)}>`);
		this.child((renderer) => {
			renderer.local.select_value = value === void 0 ? defaultValue : value;
			renderer.local.multiple = !!select_attrs.multiple;
			fn(renderer);
		});
		this.push(`${is_rich ? "<!>" : ""}</select>`);
	}
	/**
	* @param {Record<string, any>} attrs
	* @param {string | number | boolean | ((renderer: Renderer) => void)} body
	* @param {string | undefined} [css_hash]
	* @param {Record<string, boolean> | undefined} [classes]
	* @param {Record<string, string> | undefined} [styles]
	* @param {number | undefined} [flags]
	* @param {boolean | undefined} [is_rich]
	*/
	option(attrs, body, css_hash, classes, styles, flags, is_rich) {
		this.#out.push(`<option${attributes(attrs, css_hash, classes, styles, flags)}`);
		/**
		* @param {Renderer} renderer
		* @param {any} value
		* @param {{ head?: string, body: any }} content
		*/
		const close = (renderer, value, { head, body }) => {
			if (has_own_property.call(attrs, "value")) value = attrs.value;
			var select_value = this.local.select_value;
			if (this.local.multiple && is_array(select_value) ? select_value.includes(value) : value === select_value) renderer.#out.push(" selected=\"\"");
			renderer.#out.push(`>${body}${is_rich ? "<!>" : ""}</option>`);
			if (head) renderer.head((child) => child.push(head));
		};
		if (typeof body === "function") this.child((renderer) => {
			const r = new Renderer(this.global, this);
			body(r);
			if (this.global.mode === "async") return r.#collect_content_async().then((content) => {
				close(renderer, content.body.replaceAll("<!---->", ""), content);
			});
			else {
				const content = r.#collect_content();
				close(renderer, content.body.replaceAll("<!---->", ""), content);
			}
		});
		else close(this, body, { body: escape_html(body) });
	}
	/**
	* @param {(renderer: Renderer) => void} fn
	*/
	title(fn) {
		const path = this.get_path();
		/** @param {string} head */
		const close = (head) => {
			this.global.set_title(head, path);
		};
		this.child((renderer) => {
			const r = new Renderer(renderer.global, renderer);
			fn(r);
			if (renderer.global.mode === "async") return r.#collect_content_async().then((content) => {
				close(content.head);
			});
			else {
				const content = r.#collect_content();
				close(content.head);
			}
		});
	}
	/**
	* @param {string | (() => Promise<string>)} content
	*/
	push(content) {
		if (typeof content === "function") this.child(async (renderer) => renderer.push(await content()));
		else this.#out.push(content);
	}
	/**
	* @param {() => void} fn
	*/
	on_destroy(fn) {
		(this.#on_destroy ??= []).push(fn);
	}
	/**
	* @returns {number[]}
	*/
	get_path() {
		return this.#parent ? [...this.#parent.get_path(), this.#parent.#out.indexOf(this)] : [];
	}
	/**
	* @deprecated this is needed for legacy component bindings
	*/
	copy() {
		const copy = new Renderer(this.global, this.#parent);
		copy.type = this.type;
		copy.#out = this.#out.map((item) => item instanceof Renderer ? item.copy() : item);
		copy.promise = this.promise;
		return copy;
	}
	/**
	* @param {Renderer} other
	* @deprecated this is needed for legacy component bindings
	*/
	subsume(other) {
		if (this.global.mode !== other.global.mode) throw new Error("invariant: A renderer cannot switch modes. If you're seeing this, there's a compiler bug. File an issue!");
		this.local = other.local;
		this.#out = other.#out.map((item, i) => {
			const current = this.#out[i];
			if (current instanceof Renderer && item instanceof Renderer) {
				current.subsume(item);
				return current;
			}
			return item;
		});
		this.promise = other.promise;
		this.type = other.type;
	}
	get length() {
		return this.#out.length;
	}
	/**
	* Creates the hydration comment that marks the start of a failed boundary.
	* The error is JSON-serialized and embedded inside an HTML comment for the client
	* to parse during hydration. The JSON is escaped to prevent `-->` or `<!--` sequences
	* from breaking out of the comment (XSS). Uses unicode escapes which `JSON.parse()`
	* handles transparently.
	* @param {unknown} error
	* @returns {string}
	*/
	static #serialize_failed_boundary(error) {
		return `<!--[?${JSON.stringify(error).replace(/>/g, "\\u003e").replace(/</g, "\\u003c")}-->`;
	}
	/**
	* Only available on the server and when compiling with the `server` option.
	* Takes a component and returns an object with `body` and `head` properties on it, which you can use to populate the HTML when server-rendering your app.
	* @template {Record<string, any>} Props
	* @param {Component<Props>} component
	* @param {{ props?: Omit<Props, '$$slots' | '$$events'>; context?: Map<any, any>; idPrefix?: string; csp?: Csp }} [options]
	* @returns {RenderOutput}
	*/
	static render(component, options = {}) {
		return new RenderResult(() => Renderer.#render(component, options), () => init_render_context().then(() => with_render_context(() => Renderer.#render_async(component, options))));
	}
	/**
	* Collect all of the `onDestroy` callbacks registered during rendering. In an async context, this is only safe to call
	* after awaiting `collect_async`.
	*
	* Child renderers are "porous" and don't affect execution order, but component body renderers
	* create ordering boundaries. Within a renderer, callbacks run in order until hitting a component boundary.
	* @returns {Iterable<() => void>}
	*/
	*#collect_on_destroy() {
		for (const component of this.#traverse_components()) yield* component.#collect_ondestroy();
	}
	/**
	* Performs a depth-first search of renderers, yielding the deepest components first, then additional components as we backtrack up the tree.
	* @returns {Iterable<Renderer>}
	*/
	*#traverse_components() {
		for (const child of this.#out) if (typeof child !== "string") yield* child.#traverse_components();
		if (this.#is_component_body) yield this;
	}
	/**
	* @returns {Iterable<() => void>}
	*/
	*#collect_ondestroy() {
		if (this.#on_destroy) for (const fn of this.#on_destroy) yield fn;
		for (const child of this.#out) if (child instanceof Renderer && !child.#is_component_body) yield* child.#collect_ondestroy();
	}
	/**
	* Runs every `onDestroy` callback in this renderer tree. On a failed render,
	* cleanup errors are suppressed so they do not mask the render error.
	* @param {boolean} suppress_errors
	*/
	#run_on_destroy(suppress_errors) {
		let first_error;
		let has_error = false;
		for (const cleanup of this.#collect_on_destroy()) try {
			cleanup();
		} catch (error) {
			if (!suppress_errors && !has_error) {
				first_error = error;
				has_error = true;
			}
		}
		if (has_error) throw first_error;
	}
	/**
	* @param {'sync' | 'async'} mode
	* @param {{ idPrefix?: string; csp?: Csp; transformError?: (error: unknown) => unknown }} options
	* @returns {Renderer}
	*/
	static #create(mode, options) {
		if (options.idPrefix?.includes("--")) invalid_id_prefix();
		return new Renderer(new SSRState(mode, options.idPrefix ? options.idPrefix + "-" : "", options.csp, options.transformError));
	}
	/**
	* Render a component. Throws if any of the children are performing asynchronous work.
	*
	* @template {Record<string, any>} Props
	* @param {Component<Props>} component
	* @param {{ props?: Omit<Props, '$$slots' | '$$events'>; context?: Map<any, any>; idPrefix?: string }} options
	* @returns {AccumulatedContent}
	*/
	static #render(component, options) {
		var previous_context = ssr_context;
		const renderer = Renderer.#create("sync", options);
		/** @type {AccumulatedContent | undefined} */
		let result;
		let render_error;
		let failed = false;
		try {
			try {
				Renderer.#open_render(renderer, component, options);
				result = Renderer.#close_render(renderer.#collect_content(), renderer);
			} catch (error) {
				render_error = error;
				failed = true;
			}
			renderer.#run_on_destroy(failed);
			if (failed) throw render_error;
			return result;
		} finally {
			renderer.global.abort();
			set_ssr_context(previous_context);
		}
	}
	/**
	* Render a component.
	*
	* @template {Record<string, any>} Props
	* @param {Component<Props>} component
	* @param {{ props?: Omit<Props, '$$slots' | '$$events'>; context?: Map<any, any>; idPrefix?: string; csp?: Csp }} options
	* @returns {Promise<AccumulatedContent & { hashes: { script: Sha256Source[] } }>}
	*/
	static async #render_async(component, options) {
		const previous_context = ssr_context;
		const renderer = Renderer.#create("async", options);
		/** @type {(AccumulatedContent & { hashes: { script: Sha256Source[] } }) | undefined} */
		let result;
		let render_error;
		let failed = false;
		try {
			try {
				Renderer.#open_render(renderer, component, options);
				const content = await renderer.#collect_content_async();
				const hydratables = await renderer.#collect_hydratables();
				if (hydratables !== null) content.head = hydratables + content.head;
				result = Renderer.#close_render(content, renderer);
			} catch (error) {
				render_error = error;
				failed = true;
				renderer.global.abort();
				await renderer.global.settle();
			}
			renderer.#run_on_destroy(failed);
			if (failed) throw render_error;
			return result;
		} finally {
			set_ssr_context(previous_context);
			renderer.global.abort();
		}
	}
	/**
	* Collect all of the code from the `out` array and return it as a string, or a promise resolving to a string.
	* @param {AccumulatedContent} content
	* @returns {AccumulatedContent}
	*/
	#collect_content(content = {
		head: "",
		body: ""
	}) {
		for (const item of this.#out) if (typeof item === "string") content[this.type] += item;
		else if (item instanceof Renderer) item.#collect_content(content);
		return content;
	}
	/**
	* Collect all of the code from the `out` array and return it as a string.
	* @param {AccumulatedContent} content
	* @returns {Promise<AccumulatedContent>}
	*/
	async #collect_content_async(content = {
		head: "",
		body: ""
	}) {
		await this.promise;
		for (const item of this.#out) if (typeof item === "string") content[this.type] += item;
		else if (item instanceof Renderer) {
			if (item.#boundary) {
				/** @type {AccumulatedContent} */
				const boundary_content = {
					head: "",
					body: ""
				};
				try {
					await item.#collect_content_async(boundary_content);
					content.head += boundary_content.head;
					content.body += boundary_content.body;
				} catch (error) {
					const { context, failed, transformError } = item.#boundary;
					set_ssr_context(context);
					let promise = transformError(error);
					set_ssr_context(null);
					let transformed = await promise;
					set_ssr_context(context);
					const failed_renderer = new Renderer(item.global, item);
					failed_renderer.type = item.type;
					failed_renderer.#out.push(Renderer.#serialize_failed_boundary(transformed));
					failed(failed_renderer, transformed, noop);
					failed_renderer.#out.push(BLOCK_CLOSE);
					await failed_renderer.#collect_content_async(content);
				}
			} else await item.#collect_content_async(content);
		}
		return content;
	}
	async #collect_hydratables() {
		const ctx = get_render_context().hydratable;
		for (const [_, key] of ctx.unresolved_promises) unresolved_hydratable(key, ctx.lookup.get(key)?.stack ?? "<missing stack trace>");
		for (const comparison of ctx.comparisons) await comparison;
		return await this.#hydratable_block(ctx);
	}
	/**
	* @template {Record<string, any>} Props
	* @param {Renderer} renderer
	* @param {import('svelte').Component<Props>} component
	* @param {{ props?: Omit<Props, '$$slots' | '$$events'>; context?: Map<any, any>; idPrefix?: string; csp?: Csp; transformError?: (error: unknown) => unknown }} options
	* @returns {void}
	*/
	static #open_render(renderer, component, options) {
		var previous_context = ssr_context;
		try {
			set_ssr_context({
				p: null,
				c: options.context ?? null,
				r: renderer,
				i: false
			});
			renderer.push(BLOCK_OPEN);
			component(renderer, options.props ?? {});
			renderer.push(BLOCK_CLOSE);
		} finally {
			set_ssr_context(previous_context);
		}
	}
	/**
	* @param {AccumulatedContent} content
	* @param {Renderer} renderer
	* @returns {AccumulatedContent & { hashes: { script: Sha256Source[] } }}
	*/
	static #close_render(content, renderer) {
		let head = content.head + renderer.global.get_title();
		let body = content.body;
		for (const { hash, code } of renderer.global.css) head += `<style id="${hash}">${code}</style>`;
		return {
			head,
			body,
			hashes: { script: renderer.global.csp.script_hashes }
		};
	}
	/**
	* @param {HydratableContext} ctx
	*/
	async #hydratable_block(ctx) {
		if (ctx.lookup.size === 0) return null;
		let entries = [];
		let has_promises = false;
		for (const [k, v] of ctx.lookup) {
			if (v.promises) {
				has_promises = true;
				for (const p of v.promises) await p;
			}
			entries.push(`[${uneval(k)},${v.serialized}]`);
		}
		let prelude = `const h = (window.__svelte ??= {}).h ??= new Map();`;
		if (has_promises) prelude = `const r = (v) => Promise.resolve(v);
				${prelude}`;
		const body = `
			{
				${prelude}

				for (const [k, v] of [
					${entries.join(",\n					")}
				]) {
					h.set(k, v);
				}
			}
		`;
		let csp_attr = "";
		if (this.global.csp.nonce) csp_attr = ` nonce="${this.global.csp.nonce}"`;
		else if (this.global.csp.hash) {
			const hash = await sha256(body);
			this.global.csp.script_hashes.push(`sha256-${hash}`);
		}
		return `\n\t\t<script${csp_attr}>${body}<\/script>`;
	}
};
var SSRState = class {
	/** @readonly @type {Csp & { script_hashes: Sha256Source[] }} */
	csp;
	/** @readonly @type {'sync' | 'async'} */
	mode;
	/** @readonly @type {() => string} */
	uid;
	/** @readonly @type {Set<{ hash: string; code: string }>} */
	css = /* @__PURE__ */ new Set();
	/** @type {Set<Promise<unknown>>} */
	#pending = /* @__PURE__ */ new Set();
	/** @type {AbortController | null} */
	#controller = null;
	#aborted = false;
	/**
	* `transformError` passed to `render`. Called when an error boundary catches an error.
	* Throws by default if unset in `render`.
	* @type {(error: unknown) => unknown}
	*/
	transformError;
	/** @type {{ path: number[], value: string }} */
	#title = {
		path: [],
		value: ""
	};
	/**
	* @param {'sync' | 'async'} mode
	* @param {string} id_prefix
	* @param {Csp} csp
	* @param {((error: unknown) => unknown) | undefined} [transformError]
	*/
	constructor(mode, id_prefix = "", csp = { hash: false }, transformError) {
		this.mode = mode;
		this.csp = {
			...csp,
			script_hashes: []
		};
		this.transformError = transformError ?? ((error) => {
			throw error;
		});
		let uid = 1;
		this.uid = () => `${id_prefix}s${uid++}`;
	}
	/**
	* @template T
	* @param {Promise<T>} promise
	* @returns {Promise<T>}
	*/
	track(promise) {
		this.#pending.add(promise);
		promise.then(() => this.#pending.delete(promise), () => this.#pending.delete(promise));
		return promise;
	}
	async settle() {
		while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
	}
	abort() {
		if (this.#aborted) return;
		this.#aborted = true;
		this.#controller?.abort(STALE_REACTION);
	}
	get_abort_signal() {
		const controller = this.#controller ??= new AbortController();
		if (this.#aborted) controller.abort(STALE_REACTION);
		return controller.signal;
	}
	get_title() {
		return this.#title.value;
	}
	/**
	* Performs a depth-first (lexicographic) comparison using the path. Rejects sets
	* from earlier than or equal to the current value.
	* @param {string} value
	* @param {number[]} path
	*/
	set_title(value, path) {
		const current = this.#title.path;
		let i = 0;
		let l = Math.min(path.length, current.length);
		while (i < l && path[i] === current[i]) i += 1;
		if (path[i] === void 0) return;
		if (current[i] === void 0 || path[i] > current[i]) {
			this.#title.path = path;
			this.#title.value = value;
		}
	}
};
var INVALID_ATTR_NAME_CHAR_REGEX = /[\s'">/=\u{FDD0}-\u{FDEF}\u{FFFE}\u{FFFF}\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u;
/**
* Only available on the server and when compiling with the `server` option.
* Takes a component and returns an object with `body` and `head` properties on it, which you can use to populate the HTML when server-rendering your app.
* @template {Record<string, any>} Props
* @param {Component<Props> | ComponentType<SvelteComponent<Props>>} component
* @param {{ props?: Omit<Props, '$$slots' | '$$events'>; context?: Map<any, any>; idPrefix?: string; csp?: Csp; transformError?: (error: unknown) => unknown }} [options]
* @returns {RenderOutput}
*/
function render(component, options = {}) {
	if (options.csp?.hash && options.csp.nonce) invalid_csp();
	return Renderer.render(component, options);
}
/**
* @param {Record<string, unknown>} attrs
* @param {string} [css_hash]
* @param {Record<string, boolean>} [classes]
* @param {Record<string, string>} [styles]
* @param {number} [flags]
* @returns {string}
*/
function attributes(attrs, css_hash, classes, styles, flags = 0) {
	if (styles) attrs.style = to_style(attrs.style, styles);
	if (attrs.class) attrs.class = clsx(attrs.class);
	if (css_hash || classes) attrs.class = to_class(attrs.class, css_hash, classes);
	let attr_str = "";
	let name;
	const is_html = (flags & 1) === 0;
	const lowercase = (flags & 2) === 0;
	const is_input = (flags & 4) !== 0;
	const names = Object.keys(attrs);
	outer: for (let i = 0; i < names.length; i++) {
		name = names[i];
		if (typeof attrs[name] === "function") continue;
		if (name[0] === "$" && name[1] === "$") continue;
		if (name === "" || INVALID_ATTR_NAME_CHAR_REGEX.test(name)) continue;
		var value = attrs[name];
		var lower = name.toLowerCase();
		if (lowercase) name = lower;
		if (lower.length > 2 && lower.startsWith("on")) continue;
		if (is_input) {
			if (name === "defaultvalue" || name === "defaultchecked") {
				name = name === "defaultvalue" ? "value" : "checked";
				if (name in attrs) continue;
				for (let j = 0; j < names.length; j++) if (names[j].toLowerCase() === name) continue outer;
			}
		}
		attr_str += attr(name, value, is_html && is_boolean_attribute(name));
	}
	return attr_str;
}
/**
* @param {Record<string, unknown>[]} props
* @returns {Record<string, unknown>}
*/
function spread_props(props) {
	/** @type {Record<string, unknown>} */
	const merged_props = {};
	let key;
	for (let i = 0; i < props.length; i++) {
		const obj = props[i];
		if (obj == null) continue;
		for (key of Object.keys(obj)) {
			const desc = Object.getOwnPropertyDescriptor(obj, key);
			if (desc) Object.defineProperty(merged_props, key, desc);
			else merged_props[key] = obj[key];
		}
	}
	return merged_props;
}
/**
* @param {unknown} value
* @returns {string}
*/
function stringify(value) {
	return typeof value === "string" ? value : value == null ? "" : value + "";
}
/**
* @param {any} value
* @param {string | undefined} [hash]
* @param {Record<string, boolean>} [directives]
*/
function attr_class(value, hash, directives) {
	var result = to_class(value, hash, directives);
	return result ? ` class="${escape_html(result, true)}"` : "";
}
/**
* @param {any} value
* @param {Record<string,any>|[Record<string,any>,Record<string,any>]} [directives]
*/
function attr_style(value, directives) {
	var result = to_style(value, directives);
	return result ? ` style="${escape_html(result, true)}"` : "";
}
/**
* Legacy mode: If the prop has a fallback and is bound in the
* parent component, propagate the fallback value upwards.
* @param {Record<string, unknown>} props_parent
* @param {Record<string, unknown>} props_now
*/
function bind_props(props_parent, props_now) {
	for (const key of Object.keys(props_now)) {
		const initial_value = props_parent[key];
		const value = props_now[key];
		if (initial_value === void 0 && value !== void 0 && Object.getOwnPropertyDescriptor(props_parent, key)?.set) props_parent[key] = value;
	}
}
/** @param {any} array_like_or_iterator */
function ensure_array_like(array_like_or_iterator) {
	if (array_like_or_iterator) return array_like_or_iterator.length !== void 0 ? array_like_or_iterator : Array.from(array_like_or_iterator);
	return [];
}
/**
* @template V
* @param {() => V} get_value
*/
function once(get_value) {
	let value = UNINITIALIZED;
	return () => {
		if (value === UNINITIALIZED) value = get_value();
		return value;
	};
}
/**
* @template T
* @param {()=>T} fn
* @returns {(new_value?: T) => (T | void)}
*/
function derived(fn) {
	const get_value = ssr_context === null ? fn : once(fn);
	/** @type {T | undefined} */
	let updated_value;
	return function(new_value) {
		if (arguments.length === 0) return updated_value ?? get_value();
		updated_value = new_value;
		return updated_value;
	};
}
/** @import { SSRContext } from '#server' */
/** @import { Renderer } from './internal/server/renderer.js' */
/** @param {() => void} fn */
function onDestroy(fn) {
	/** @type {Renderer} */ ssr_context.r.on_destroy(fn);
}
function colorClasses(props = {}) {
	const { color, textColor, bgColor, borderColor, rippleColor, dark } = props;
	return {
		dark,
		[`color-${color}`]: color,
		[`text-color-${textColor}`]: textColor,
		[`bg-color-${bgColor}`]: bgColor,
		[`border-color-${borderColor}`]: borderColor,
		[`ripple-color-${rippleColor}`]: rippleColor
	};
}
function routerAttrs(props = {}) {
	const { force, reloadCurrent, reloadPrevious, reloadAll, reloadDetail, animate, ignoreCache, routeTabId, view, transition, openIn } = props;
	let dataAnimate;
	if ("animate" in props && typeof animate !== "undefined") dataAnimate = animate.toString();
	let dataReloadDetail;
	if ("reloadDetail" in props && typeof reloadDetail !== "undefined") dataReloadDetail = reloadDetail.toString();
	return {
		"data-force": force || void 0,
		"data-reload-current": reloadCurrent || void 0,
		"data-reload-all": reloadAll || void 0,
		"data-reload-previous": reloadPrevious || void 0,
		"data-reload-detail": dataReloadDetail,
		"data-animate": dataAnimate,
		"data-ignore-cache": ignoreCache || void 0,
		"data-route-tab-id": routeTabId || void 0,
		"data-view": isStringProp(view) ? view : void 0,
		"data-transition": isStringProp(transition) ? transition : void 0,
		"data-open-in": isStringProp(openIn) ? openIn : void 0
	};
}
function routerClasses(props = {}) {
	const { back, linkBack, external, preventRouter } = props;
	return {
		back: back || linkBack,
		external,
		"prevent-router": preventRouter
	};
}
function actionsAttrs(props = {}) {
	const { searchbarEnable, searchbarDisable, searchbarClear, searchbarToggle, panelOpen, panelClose, panelToggle, popupOpen, popupClose, actionsOpen, actionsClose, popoverOpen, popoverClose, loginScreenOpen, loginScreenClose, sheetOpen, sheetClose, sortableEnable, sortableDisable, sortableToggle, cardOpen, cardClose } = props;
	return {
		"data-searchbar": isStringProp(searchbarEnable) && searchbarEnable || isStringProp(searchbarDisable) && searchbarDisable || isStringProp(searchbarClear) && searchbarClear || isStringProp(searchbarToggle) && searchbarToggle || void 0,
		"data-panel": isStringProp(panelOpen) && panelOpen || isStringProp(panelClose) && panelClose || isStringProp(panelToggle) && panelToggle || void 0,
		"data-popup": isStringProp(popupOpen) && popupOpen || isStringProp(popupClose) && popupClose || void 0,
		"data-actions": isStringProp(actionsOpen) && actionsOpen || isStringProp(actionsClose) && actionsClose || void 0,
		"data-popover": isStringProp(popoverOpen) && popoverOpen || isStringProp(popoverClose) && popoverClose || void 0,
		"data-sheet": isStringProp(sheetOpen) && sheetOpen || isStringProp(sheetClose) && sheetClose || void 0,
		"data-login-screen": isStringProp(loginScreenOpen) && loginScreenOpen || isStringProp(loginScreenClose) && loginScreenClose || void 0,
		"data-sortable": isStringProp(sortableEnable) && sortableEnable || isStringProp(sortableDisable) && sortableDisable || isStringProp(sortableToggle) && sortableToggle || void 0,
		"data-card": isStringProp(cardOpen) && cardOpen || isStringProp(cardClose) && cardClose || void 0
	};
}
function actionsClasses(props = {}) {
	const { searchbarEnable, searchbarDisable, searchbarClear, searchbarToggle, panelOpen, panelClose, panelToggle, popupOpen, popupClose, actionsClose, actionsOpen, popoverOpen, popoverClose, loginScreenOpen, loginScreenClose, sheetOpen, sheetClose, sortableEnable, sortableDisable, sortableToggle, cardOpen, cardPreventOpen, cardClose } = props;
	return {
		"searchbar-enable": searchbarEnable || searchbarEnable === "",
		"searchbar-disable": searchbarDisable || searchbarDisable === "",
		"searchbar-clear": searchbarClear || searchbarClear === "",
		"searchbar-toggle": searchbarToggle || searchbarToggle === "",
		"panel-close": panelClose || panelClose === "",
		"panel-open": panelOpen || panelOpen === "",
		"panel-toggle": panelToggle || panelToggle === "",
		"popup-close": popupClose || popupClose === "",
		"popup-open": popupOpen || popupOpen === "",
		"actions-close": actionsClose || actionsClose === "",
		"actions-open": actionsOpen || actionsOpen === "",
		"popover-close": popoverClose || popoverClose === "",
		"popover-open": popoverOpen || popoverOpen === "",
		"sheet-close": sheetClose || sheetClose === "",
		"sheet-open": sheetOpen || sheetOpen === "",
		"login-screen-close": loginScreenClose || loginScreenClose === "",
		"login-screen-open": loginScreenOpen || loginScreenOpen === "",
		"sortable-enable": sortableEnable || sortableEnable === "",
		"sortable-disable": sortableDisable || sortableDisable === "",
		"sortable-toggle": sortableToggle || sortableToggle === "",
		"card-close": cardClose || cardClose === "",
		"card-open": cardOpen || cardOpen === "",
		"card-prevent-open": cardPreventOpen || cardPreventOpen === ""
	};
}
var modalStateClasses = ({ isOpened, isClosing } = {}) => {
	return {
		"modal-in": isOpened && !isClosing,
		"modal-out": isClosing
	};
};
function Popup($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, style = "", tabletFullscreen = void 0, opened = void 0, animate = void 0, backdrop = void 0, backdropEl = void 0, closeByBackdropClick = void 0, closeOnEscape = void 0, swipeToClose = false, swipeHandler = void 0, push = void 0, containerEl = void 0, children, $$slots, $$events, ...restProps } = $$props;
		let f7Popup;
		let isOpened = opened;
		let isClosing = false;
		let isPushIn = false;
		function instance() {
			return f7Popup;
		}
		const classes = derived(() => classNames(className, "popup", {
			"popup-tablet-fullscreen": tabletFullscreen,
			"popup-push": push,
			"popup-push-in": push && isPushIn,
			"popup-push-closing": isClosing
		}, modalStateClasses({
			isOpened,
			isClosing
		}), colorClasses(restProps)));
		onDestroy(() => {
			if (f7Popup) f7Popup.destroy();
			f7Popup = null;
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			style,
			...restProps
		})}>`);
		children?.($$renderer, f7Popup);
		$$renderer.push(`<!----></div>`);
		bind_props($$props, { instance });
	});
}
var getRouterInitialComponent = (router, initialComponent) => {
	let initialComponentData;
	const { initialUrl } = router.getInitialUrl();
	const initialRoute = router.findMatchingRoute(initialUrl);
	let routeProps = {};
	if (initialRoute && initialRoute.route && initialRoute.route.options) routeProps = initialRoute.route.options.props;
	const isMasterRoute = (route) => {
		if (route.master === true) return true;
		if (typeof route.master === "function") return route.master(router.app);
		return false;
	};
	if (initialRoute && initialRoute.route && (initialRoute.route.component || initialRoute.route.asyncComponent) && !isMasterRoute(initialRoute.route)) initialComponentData = {
		component: initialRoute.route.component || initialRoute.route.asyncComponent,
		initialComponent,
		id: getComponentId(),
		isAsync: !!initialRoute.route.asyncComponent,
		props: {
			f7route: initialRoute,
			f7router: router,
			...initialRoute.params,
			...routeProps
		}
	};
	return {
		initialPage: initialComponentData,
		initialRoute
	};
};
var useTab = (getEl, restProps = {}) => {
	const onTabShow = (el) => {
		if (getEl() !== el) return;
		restProps.onTabShow?.(el);
	};
	const onTabHide = (el) => {
		if (getEl() !== el) return;
		restProps.onTabHide?.(el);
	};
	const detachEvents = () => {
		if (!f7) return;
		f7.off("tabShow", onTabShow);
		f7.off("tabHide", onTabHide);
	};
	onDestroy(() => {
		detachEvents();
	});
};
function Router_context_provider($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { route, router, children } = $$props;
		setContext("RouterContext", {
			route,
			router
		});
		children?.($$renderer);
		$$renderer.push(`<!---->`);
	});
}
function View($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, id = void 0, style = void 0, init = true, url = void 0, children, $$slots, $$events, ...restProps } = $$props;
		const { main, tab, tabActive, browserHistoryInitialMatch = true, initRouterOnTabShow } = restProps;
		const shouldInitRouter = derived(() => !(initRouterOnTabShow && tab && !tabActive));
		let initialPage = null;
		let initialRoute = null;
		let el = null;
		let routerData = null;
		let f7View = null;
		function instance() {
			return f7View;
		}
		function onViewInit(view) {
			restProps.onViewInit?.(view);
			restProps.onviewinit?.(view);
			if (!init) {
				f7View = view;
				routerData.instance = view;
			}
		}
		if (app.f7 && !f7View && init) {
			const routerId = getRouterId();
			f7View = app.f7.views.create(el, {
				routerId,
				init: false,
				...noUndefinedProps({
					url,
					...restProps
				}),
				browserHistoryInitialMatch,
				on: { init: onViewInit }
			});
			routerData = {
				routerId,
				instance: f7View
			};
			app.f7routers.views.push(routerData);
			if (shouldInitRouter() && f7View && f7View.router && (url || main)) {
				const initialData = getRouterInitialComponent(f7View.router);
				initialPage = initialData.initialPage;
				initialRoute = initialData.initialRoute;
				if (initialRoute && initialRoute.route && initialRoute.route.masterRoute) {
					initialPage = void 0;
					initialRoute = void 0;
				}
			}
		}
		let pages = initialPage ? [initialPage] : [];
		function onResize(view, width) {
			restProps.onViewResize?.(width);
			restProps.onviewresize?.(width);
		}
		function onSwipeBackMove(data) {
			restProps.onSwipeBackMove?.(data);
			restProps.onswipebackmove?.(data);
		}
		function onSwipeBackBeforeChange(data) {
			restProps.onSwipeBackBeforeChange?.(data);
			restProps.onswipebackbeforechange?.(data);
		}
		function onSwipeBackAfterChange(data) {
			restProps.onSwipeBackAfterChange?.(data);
			restProps.onswipebackafterchange?.(data);
		}
		function onSwipeBackBeforeReset(data) {
			restProps.onSwipeBackBeforeReset?.(data);
			restProps.onswipebackbeforereset?.(data);
		}
		function onSwipeBackAfterReset(data) {
			restProps.onSwipeBackAfterReset?.(data);
			restProps.onswipebackafterreset?.(data);
		}
		const classes = derived(() => classNames(className, "view", {
			"view-main": main,
			"tab-active": tabActive,
			tab
		}, colorClasses(restProps)));
		useTab(() => el, restProps);
		onDestroy(() => {
			if (f7View) {
				f7View.off("resize", onResize);
				f7View.off("swipebackMove", onSwipeBackMove);
				f7View.off("swipebackBeforeChange", onSwipeBackBeforeChange);
				f7View.off("swipebackAfterChange", onSwipeBackAfterChange);
				f7View.off("swipebackBeforeReset", onSwipeBackBeforeReset);
				f7View.off("swipebackAfterReset", onSwipeBackAfterReset);
				if (f7View.destroy) f7View.destroy();
				f7View = null;
			}
			app.f7routers.views.splice(app.f7routers.views.indexOf(routerData), 1);
			routerData = null;
		});
		$$renderer.push(`<div${attr_class(clsx(classes()))}${attr_style(style)}${attr("id", id)}>`);
		children?.($$renderer, f7View);
		$$renderer.push(`<!----> <!--[-->`);
		const each_array = ensure_array_like(pages);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let page = each_array[$$index];
			Router_context_provider($$renderer, {
				route: page.props.f7route,
				router: page.props.f7router,
				children: ($$renderer) => {
					if (page.component) {
						$$renderer.push("<!--[-->");
						page.component($$renderer, spread_props([page.props]));
						$$renderer.push("<!--]-->");
					} else {
						$$renderer.push("<!--[!-->");
						$$renderer.push("<!--]-->");
					}
				},
				$$slots: { default: true }
			});
		}
		$$renderer.push(`<!--]--></div>`);
		bind_props($$props, { instance });
	});
}
function Login_screen($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, style = "", opened = void 0, animate = void 0, containerEl = void 0, children, $$slots, $$events, ...restProps } = $$props;
		let f7LoginScreen = null;
		let isOpened = opened;
		let isClosing = false;
		function instance() {
			return f7LoginScreen;
		}
		const classes = derived(() => classNames(className, "login-screen", modalStateClasses({
			isOpened,
			isClosing
		}), colorClasses(restProps)));
		onDestroy(() => {
			if (f7LoginScreen) f7LoginScreen.destroy();
			f7LoginScreen = null;
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			style,
			...restProps
		})}>`);
		children?.($$renderer, f7LoginScreen);
		$$renderer.push(`<!----></div>`);
		bind_props($$props, { instance });
	});
}
function Sheet($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, style = "", opened = void 0, animate = void 0, top = void 0, bottom = void 0, position = void 0, backdrop = void 0, backdropEl = void 0, closeByBackdropClick = void 0, closeByOutsideClick = void 0, closeOnEscape = void 0, push = void 0, swipeToClose = void 0, swipeToStep = void 0, swipeHandler = void 0, containerEl = void 0, breakpoints = void 0, backdropBreakpoint = void 0, pushBreakpoint = void 0, children, fixedContent, staticContent, $$slots, $$events, ...restProps } = $$props;
		let f7Sheet;
		let isOpened = false;
		let isClosing = false;
		let swipeStep = false;
		let breakpoint = false;
		let isPushIn = false;
		function instance() {
			return f7Sheet;
		}
		const positionComputed = derived(() => {
			if (position) return position;
			if (top) return "top";
			if (bottom) return "bottom";
			return "bottom";
		});
		const classes = derived(() => classNames(className, "sheet-modal", `sheet-modal-${positionComputed()}`, {
			"sheet-modal-push": push,
			"modal-in-swipe-step": swipeStep,
			"modal-in-breakpoint": breakpoint,
			"sheet-modal-push-in": push && isPushIn,
			"sheet-modal-push-closing": isClosing
		}, modalStateClasses({
			isOpened,
			isClosing,
			swipeStep,
			breakpoint
		}), colorClasses(restProps)));
		onDestroy(() => {
			if (f7Sheet) f7Sheet.destroy();
			f7Sheet = null;
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			style,
			...restProps
		})}>`);
		fixedContent?.($$renderer, f7Sheet);
		$$renderer.push(`<!----> <div class="sheet-modal-inner">`);
		children?.($$renderer, f7Sheet);
		$$renderer.push(`<!----> `);
		staticContent?.($$renderer, f7Sheet);
		$$renderer.push(`<!----></div></div>`);
		bind_props($$props, { instance });
	});
}
function Popover($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, style = "", opened = void 0, animate = void 0, targetEl = void 0, backdrop = void 0, backdropEl = void 0, closeByBackdropClick = void 0, closeByOutsideClick = void 0, closeOnEscape = void 0, containerEl = void 0, verticalPosition = void 0, children, $$slots, $$events, ...restProps } = $$props;
		let f7Popover;
		let isOpened = opened;
		let isClosing = false;
		function instance() {
			return f7Popover;
		}
		const classes = derived(() => classNames(className, "popover", modalStateClasses({
			isOpened,
			isClosing
		}), colorClasses(restProps)));
		onDestroy(() => {
			if (f7Popover) f7Popover.destroy();
			f7Popover = null;
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			style,
			...restProps
		})}><div class="popover-inner">`);
		children?.($$renderer, f7Popover);
		$$renderer.push(`<!----></div></div>`);
		bind_props($$props, { instance });
	});
}
function Panel($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, side = void 0, effect: effectProp = void 0, cover = false, reveal = false, push = false, floating = false, left = false, right = false, opened = false, resizable = false, backdrop = true, backdropEl = void 0, containerEl = void 0, closeByBackdropClick = void 0, visibleBreakpoint = void 0, collapsedBreakpoint = void 0, swipe = false, swipeNoFollow = false, swipeOnlyClose = false, swipeActiveArea = 0, swipeThreshold = 0, f7Slot = "fixed", children, $$slots, $$events, ...restProps } = $$props;
		let f7Panel = null;
		let isOpened = false;
		let isClosing = false;
		let isCollapsed = false;
		let isBreakpoint = false;
		function instance() {
			return f7Panel;
		}
		const sideComputed = derived(() => side || (left ? "left" : right ? "right" : "left"));
		const effectComputed = derived(() => effectProp || (reveal ? "reveal" : push ? "push" : floating ? "floating" : "cover"));
		const classes = derived(() => classNames(className, "panel", {
			"panel-in": isOpened,
			"panel-out": isClosing,
			"panel-in-breakpoint": isBreakpoint,
			"panel-in-collapsed": isCollapsed,
			"panel-resizable": resizable,
			[`panel-${sideComputed()}`]: sideComputed(),
			[`panel-${effectComputed()}`]: effectComputed()
		}, colorClasses(restProps)));
		onDestroy(() => {
			if (f7Panel && f7Panel.destroy) f7Panel.destroy();
			f7Panel = null;
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			"data-f7-slot": f7Slot,
			...restProps
		})}>`);
		children?.($$renderer, f7Panel);
		$$renderer.push(`<!----> `);
		if (resizable) $$renderer.push(`<!--[0--><div class="panel-resize-handler"></div>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
		bind_props($$props, { instance });
	});
}
function Router_open_in_component($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let openIn = $$props["openIn"];
		let url = $$props["url"];
		let viewSelector = $$props["viewSelector"];
		let targetEl = $$props["targetEl"];
		let side = $$props["side"];
		let effect = $$props["effect"];
		if (openIn === "popup") {
			$$renderer.push("<!--[0-->");
			Popup($$renderer, {
				className: "popup-router-open-in",
				"data-url": url,
				children: ($$renderer) => {
					View($$renderer, {
						linksView: viewSelector,
						url,
						ignoreOpenIn: true
					});
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (openIn === "loginScreen") {
			$$renderer.push("<!--[0-->");
			Login_screen($$renderer, {
				className: "login-screen-router-open-in",
				"data-url": url,
				children: ($$renderer) => {
					View($$renderer, {
						linksView: viewSelector,
						url,
						ignoreOpenIn: true
					});
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (openIn === "sheet") {
			$$renderer.push("<!--[0-->");
			Sheet($$renderer, {
				className: "sheet-modal-router-open-in",
				"data-url": url,
				children: ($$renderer) => {
					View($$renderer, {
						linksView: viewSelector,
						url,
						ignoreOpenIn: true
					});
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (openIn === "popover") {
			$$renderer.push("<!--[0-->");
			Popover($$renderer, {
				className: "popover-router-open-in",
				targetEl,
				"data-url": url,
				children: ($$renderer) => {
					View($$renderer, {
						linksView: viewSelector,
						url,
						ignoreOpenIn: true
					});
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (openIn.indexOf("panel") === 0) {
			$$renderer.push("<!--[0-->");
			Panel($$renderer, {
				side,
				effect,
				className: "panel-router-open-in",
				"data-url": url,
				children: ($$renderer) => {
					View($$renderer, {
						linksView: viewSelector,
						url,
						ignoreOpenIn: true
					});
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		bind_props($$props, {
			openIn,
			url,
			viewSelector,
			targetEl,
			side,
			effect
		});
	});
}
var routerOpenIn = (router, url, options) => {
	const navigateOptions = {
		url,
		route: {
			path: url,
			options: {
				...options,
				openIn: void 0,
				props: {
					...options.props || {},
					url,
					openIn: options.openIn,
					viewSelector: router.view.selector
				}
			}
		}
	};
	const openInType = options.openIn.split(":")[0];
	const params = {
		...options,
		...options[`${openInType}Options`] || {}
	};
	delete params[`${openInType}Options`];
	params.component = Router_open_in_component;
	if (options.openIn === "popup") navigateOptions.route.popup = params;
	if (options.openIn === "loginScreen") navigateOptions.route.loginScreen = params;
	if (options.openIn === "sheet") navigateOptions.route.sheet = params;
	if (options.openIn === "popover") {
		params.targetEl = options.clickedEl || options.targetEl;
		navigateOptions.route.popover = params;
		navigateOptions.route.options.props.targetEl = params.targetEl;
	}
	if (options.openIn.indexOf("panel") >= 0) {
		const parts = options.openIn.split(":");
		navigateOptions.route.options.props.side = parts[1] || "left";
		navigateOptions.route.options.props.effect = parts[2] || "cover";
		navigateOptions.route.panel = params;
	}
	return router.navigate(navigateOptions);
};
var getChildrenArray = (el) => {
	const arr = [];
	for (let i = 0; i < el.children.length; i += 1) arr.push(el.children[i]);
	return arr;
};
var hasSameChildren = (childrenBefore, childrenAfter) => {
	if (childrenBefore.length !== childrenAfter.length) return false;
	if ((/* @__PURE__ */ new Set([...childrenBefore, ...childrenAfter])).size === childrenBefore.length) return true;
	return false;
};
var components_router_default = { proto: {
	openIn(router, navigateUrl, options) {
		return routerOpenIn(router, navigateUrl, options);
	},
	pageComponentLoader({ routerEl, component, options, resolve, reject, direction }) {
		const router = this;
		const routerId = router.id;
		const el = routerEl;
		let viewRouter;
		app.f7routers.views.forEach((data) => {
			if (data.el && data.el === routerEl || data.routerId && data.routerId === routerId) viewRouter = data;
		});
		if (!viewRouter) {
			reject();
			return;
		}
		const pageData = {
			component,
			id: getComponentId(),
			props: extend({
				f7route: options.route,
				f7router: router
			}, options.route.params, options.props || {})
		};
		let resolved;
		const childrenBefore = getChildrenArray(el);
		function onDidUpdate(componentRouterData) {
			if (componentRouterData !== viewRouter || resolved) return;
			const childrenAfter = getChildrenArray(el);
			if (hasSameChildren(childrenBefore, childrenAfter)) return;
			app.f7events.off("viewRouterDidUpdate", onDidUpdate);
			const pageEl = childrenAfter.find((child) => child.classList.contains("page") && !childrenBefore.includes(child)) || el.children[direction === "backward" ? 0 : el.children.length - 1];
			pageData.el = pageEl;
			resolve(pageEl);
			viewRouter.setPages(viewRouter.pages);
			resolved = true;
		}
		app.f7events.on("viewRouterDidUpdate", onDidUpdate);
		if (direction === "backward") viewRouter.pages.unshift(pageData);
		else viewRouter.pages.push(pageData);
		viewRouter.setPages(viewRouter.pages);
	},
	removePage($pageEl) {
		if (!$pageEl) return;
		const router = this;
		let f7Page;
		if ("length" in $pageEl && $pageEl[0]) f7Page = $pageEl[0].f7Page;
		else f7Page = $pageEl.f7Page;
		if (f7Page && f7Page.route && f7Page.route.route && f7Page.route.route.keepAlive) {
			router.app.$($pageEl).remove();
			return;
		}
		let viewRouter;
		app.f7routers.views.forEach((data) => {
			if (data.el && data.el === router.el) viewRouter = data;
		});
		let pageEl;
		if ("length" in $pageEl) {
			if ($pageEl.length === 0) return;
			pageEl = $pageEl[0];
		} else pageEl = $pageEl;
		if (!pageEl) return;
		let pageComponentFound;
		viewRouter.pages.forEach((page, index) => {
			if (page.el === pageEl) {
				pageComponentFound = true;
				viewRouter.pages.splice(index, 1);
				viewRouter.setPages(viewRouter.pages);
			}
		});
		if (!pageComponentFound) pageEl.parentNode.removeChild(pageEl);
	},
	tabComponentLoader({ tabEl, component, options, resolve, reject } = {}) {
		const router = this;
		if (!tabEl) reject();
		let tabRouter;
		app.f7routers.tabs.forEach((tabData) => {
			if (tabData.el && tabData.el === tabEl) tabRouter = tabData;
		});
		if (!tabRouter) {
			reject();
			return;
		}
		const tabContent = {
			id: getComponentId(),
			component,
			props: extend({
				f7route: options.route,
				f7router: router
			}, options.route.route && options.route.route.tab && options.route.route.tab.options && options.route.route.tab.options.props || {}, options.route.params, options.props || {})
		};
		let resolved;
		function onDidUpdate(componentRouterData) {
			if (componentRouterData !== tabRouter || resolved) return;
			app.f7events.off("tabRouterDidUpdate", onDidUpdate);
			const tabContentEl = tabEl.children[0];
			resolve(tabContentEl);
			resolved = true;
		}
		app.f7events.on("tabRouterDidUpdate", onDidUpdate);
		tabRouter.setTabContent(tabContent);
	},
	removeTabContent(tabEl) {
		if (!tabEl) return;
		let tabRouter;
		app.f7routers.tabs.forEach((tabData) => {
			if (tabData.el && tabData.el === tabEl) tabRouter = tabData;
		});
		if (!tabRouter) {
			tabEl.innerHTML = "";
			return;
		}
		tabRouter.setTabContent(null);
	},
	modalComponentLoader({ component, options, resolve, reject } = {}) {
		const router = this;
		const modalsRouter = app.f7routers.modals;
		if (!modalsRouter) {
			reject();
			return;
		}
		const modalData = {
			component,
			id: getComponentId(),
			props: extend({
				f7route: options.route,
				f7router: router
			}, options.route.params, options.props || {})
		};
		let resolved;
		function onDidUpdate() {
			if (resolved) return;
			app.f7events.off("modalsRouterDidUpdate", onDidUpdate);
			const modalEl = modalsRouter.el.children[modalsRouter.el.children.length - 1];
			modalData.el = modalEl;
			resolve(modalEl);
			resolved = true;
		}
		app.f7events.on("modalsRouterDidUpdate", onDidUpdate);
		modalsRouter.modals.push(modalData);
		modalsRouter.setModals(modalsRouter.modals);
	},
	removeModal(modalEl) {
		const modalsRouter = app.f7routers.modals;
		if (!modalsRouter) return;
		let modalDataToRemove;
		modalsRouter.modals.forEach((modalData) => {
			if (modalData.el === modalEl) modalDataToRemove = modalData;
		});
		modalsRouter.modals.splice(modalsRouter.modals.indexOf(modalDataToRemove), 1);
		modalsRouter.setModals(modalsRouter.modals);
	}
} };
var Framework7Svelte = {
	name: "sveltePlugin",
	installed: false,
	install(params = {}) {
		const Framework7 = this;
		app.Framework7 = Framework7;
		if (Framework7Svelte.installed) return;
		Framework7Svelte.installed = true;
		f7initEvents();
		const { theme: paramsTheme, userAgent } = params;
		if (paramsTheme === "md") {
			app.theme.md = true;
			theme.md = true;
		}
		if (paramsTheme === "ios") {
			app.theme.md = true;
			theme.ios = true;
		}
		if ((typeof window === "undefined" ? !!userAgent : true) && (!paramsTheme || paramsTheme === "auto")) {
			const device = Framework7.getDevice({ userAgent }, true);
			app.theme.ios = !!device.ios;
			theme.ios = app.theme.ios;
			app.theme.md = !app.theme.ios;
			theme.md = app.theme.md;
		}
		f7ready(() => {
			setTheme();
		});
		Framework7.Router.use(components_router_default);
	}
};
function Accordion_content($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "accordion-item-content", colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Accordion_item($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, opened = false, children, $$slots, $$events, ...restProps } = $$props;
		let el = null;
		const classes = derived(() => classNames(className, "accordion-item", { "accordion-item-opened": opened }, colorClasses(restProps)));
		function onBeforeOpen(accEl, prevent) {
			if (accEl !== el) return;
			restProps.onaccordionbeforeopen?.(prevent);
			restProps.onAccordionBeforeOpen?.(prevent);
		}
		function onOpen(accEl) {
			if (accEl !== el) return;
			restProps.onaccordionopen?.();
			restProps.onAccordionOpen?.();
		}
		function onOpened(accEl) {
			if (accEl !== el) return;
			restProps.onaccordionopened?.();
			restProps.onAccordionOpened?.();
		}
		function onBeforeClose(accEl, prevent) {
			if (accEl !== el) return;
			restProps.onaccordionbeforeclose?.(prevent);
			restProps.onAccordionBeforeClose?.(prevent);
		}
		function onClose(accEl) {
			if (accEl !== el) return;
			restProps.onaccordionclose?.();
			restProps.onAccordionClose?.();
		}
		function onClosed(accEl) {
			if (accEl !== el) return;
			restProps.onaccordionclosed?.();
			restProps.onAccordionClosed?.();
		}
		onDestroy(() => {
			if (!app.f7 || true) return;
			app.f7.off("accordionBeforeOpen", onBeforeOpen);
			app.f7.off("accordionOpen", onOpen);
			app.f7.off("accordionOpened", onOpened);
			app.f7.off("accordionBeforeClose", onBeforeClose);
			app.f7.off("accordionClose", onClose);
			app.f7.off("accordionClosed", onClosed);
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Accordion_toggle($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "accordion-item-toggle", colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Accordion($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, accordionOpposite = false, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "accordion-list", accordionOpposite && "accordion-opposite", colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Routable_modals($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let modals = [];
		let routerData = null;
		onDestroy(() => {
			if (!routerData) return;
			app.f7routers.modals = null;
			routerData = null;
		});
		$$renderer.push(`<div class="framework7-modals"><!--[-->`);
		const each_array = ensure_array_like(modals);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let Modal = each_array[$$index];
			if (Modal.component) {
				$$renderer.push("<!--[-->");
				Modal.component($$renderer, spread_props([Modal.props]));
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		}
		$$renderer.push(`<!--]--></div>`);
	});
}
function App($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, children, $$slots, $$events, ...restProps } = $$props;
		let el = null;
		const classes = derived(() => classNames(className, "framework7-root", colorClasses(restProps)));
		if (!app.f7 || typeof window === "undefined") f7init(el, noUndefinedProps(restProps), false);
		$$renderer.push(`<div${attr_class(clsx(classes()))}>`);
		children?.($$renderer);
		$$renderer.push(`<!----> `);
		Routable_modals($$renderer, {});
		$$renderer.push(`<!----></div>`);
	});
}
function Badge($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, tooltip, tooltipTrigger, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "badge", colorClasses(restProps)));
		$$renderer.push(`<span${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></span>`);
	});
}
var useIcon = (restProps = {}) => {
	const { icon, iconMaterial, iconF7, iconMd, iconIos, iconColor, iconSize, iconBadge, badgeColor, iconBadgeColor } = restProps;
	if (icon || iconMaterial || iconF7 || iconMd || iconIos) return {
		props: {
			material: iconMaterial,
			f7: iconF7,
			icon,
			md: iconMd,
			ios: iconIos,
			color: iconColor,
			size: iconSize
		},
		badge: iconBadge || iconBadge === 0 ? {
			props: { color: badgeColor || iconBadgeColor },
			content: iconBadge
		} : null
	};
	return null;
};
var useTheme = (set) => {
	const t = app.f7 ? app.theme : null;
	if (!app.f7) f7ready(() => {
		set(app.theme);
	});
	return t;
};
function Icon($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, style = void 0, material = void 0, f7 = void 0, icon = void 0, ios = void 0, md = void 0, tooltip = void 0, tooltipTrigger = void 0, size = void 0, children, $$slots, $$events, ...restProps } = $$props;
		let theme = useTheme((t) => {
			theme = t;
		});
		let themeIcon = derived(() => {
			if (theme) {
				if (theme.ios) return ios;
				if (theme.md) return md;
			}
		});
		const classes = derived(() => {
			let res;
			if (themeIcon()) {
				res = { icon: true };
				const parts = themeIcon().split(":");
				const prop = parts[0];
				const value = parts[1];
				if (prop === "material" || prop === "f7") {
					res["material-icons"] = prop === "material";
					res["f7-icons"] = prop === "f7";
					if (prop === "icon") res[value] = true;
				} else {
					if (themeIcon().includes(":")) themeIcon(themeIcon().split(" ").map((el) => el.replace("icon:", "")).join(" "));
					res[themeIcon()] = true;
				}
				if (icon) res[icon] = true;
			} else {
				res = {
					icon: true,
					"material-icons": material,
					"f7-icons": f7
				};
				if (icon) res[icon] = true;
			}
			return res;
		});
		const iconClasses = derived(() => classNames(className, classes(), colorClasses(restProps)));
		function iconTextComputed(t) {
			let textComputed = material || f7;
			if (md && t && t.md && (md.indexOf("material:") >= 0 || md.indexOf("f7:") >= 0)) textComputed = md.split(":")[1];
			else if (ios && t && t.ios && (ios.indexOf("material:") >= 0 || ios.indexOf("f7:") >= 0)) textComputed = ios.split(":")[1];
			return textComputed;
		}
		const iconText = derived(() => iconTextComputed(theme));
		const iconSize = derived(() => typeof size === "number" || parseFloat(size) === size * 1 ? `${size}px` : size);
		const iconStyle = derived(() => (style || "") + (iconSize() ? `;font-size: ${iconSize()}; width: ${iconSize()}; height: ${iconSize()}`.replace(";;", "") : ""));
		$$renderer.push(`<i${attributes({
			style: iconStyle(),
			class: clsx(iconClasses()),
			...restProps
		})}>${escape_html(iconText() || "")} `);
		children?.($$renderer);
		$$renderer.push(`<!----></i>`);
	});
}
function Use_icon($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { icon } = $$props;
		Icon($$renderer, spread_props([icon.props, {
			children: ($$renderer) => {
				if (icon.badge) {
					$$renderer.push("<!--[0-->");
					Badge($$renderer, spread_props([icon.badge.props, {
						children: ($$renderer) => {
							$$renderer.push(`<!---->${escape_html(icon.badge.content)}`);
						},
						$$slots: { default: true }
					}]));
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}]));
	});
}
function Preloader($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, size = void 0, style = void 0, children, $$slots, $$events, ...restProps } = $$props;
		let theme = useTheme((t) => {
			theme = t;
		});
		const sizeComputed = derived(() => size && typeof size === "string" && size.indexOf("px") >= 0 ? size.replace("px", "") : size);
		const preloaderStyle = derived(() => ((style || "") + (sizeComputed() ? `;width: ${sizeComputed()}px; height: ${sizeComputed()}px; --f7-preloader-size: ${sizeComputed()}px` : "")).replace(";;", ";"));
		const classes = derived(() => classNames(className, { preloader: true }, colorClasses(restProps)));
		$$renderer.push(`<span${attributes({
			style: preloaderStyle(),
			class: clsx(classes()),
			...restProps
		})}>`);
		if (theme && theme.md) $$renderer.push(`<!--[0--><span class="preloader-inner"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"></circle></svg></span>`);
		else if (theme && theme.ios) $$renderer.push(`<!--[1--><span class="preloader-inner"><span class="preloader-inner-line"></span> <span class="preloader-inner-line"></span> <span class="preloader-inner-line"></span> <span class="preloader-inner-line"></span> <span class="preloader-inner-line"></span> <span class="preloader-inner-line"></span> <span class="preloader-inner-line"></span> <span class="preloader-inner-line"></span></span>`);
		else $$renderer.push(`<!--[-1--><span class="preloader-inner"></span>`);
		$$renderer.push(`<!--]--></span>`);
	});
}
function Button($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, text = void 0, tabLink = void 0, tabLinkActive = false, type = void 0, href = "#", target = void 0, round = false, roundMd = false, roundIos = false, fill = false, fillMd = false, fillIos = false, tonal = false, tonalMd = false, tonalIos = false, large = false, largeMd = false, largeIos = false, small = false, smallMd = false, smallIos = false, raised = false, raisedMd = false, raisedIos = false, outline = false, outlineMd = false, outlineIos = false, active = false, disabled = false, tooltip = void 0, tooltipTrigger = void 0, routeProps = void 0, preloader = false, preloaderSize = void 0, preloaderColor = void 0, loading = false, children, $$slots, $$events, ...restProps } = $$props;
		const hrefComputed = derived(() => href === true ? "#" : href || void 0);
		const attrs = derived(() => extend({
			href: hrefComputed(),
			target,
			type,
			"data-tab": isStringProp(tabLink) && tabLink || void 0,
			...restProps
		}, routerAttrs(restProps), actionsAttrs(restProps)));
		const classes = derived(() => classNames(className, "button", {
			"tab-link": tabLink || tabLink === "",
			"tab-link-active": tabLinkActive,
			"button-round": round,
			"button-round-ios": roundIos,
			"button-round-md": roundMd,
			"button-fill": fill,
			"button-fill-ios": fillIos,
			"button-fill-md": fillMd,
			"button-tonal": tonal,
			"button-tonal-ios": tonalIos,
			"button-tonal-md": tonalMd,
			"button-large": large,
			"button-large-ios": largeIos,
			"button-large-md": largeMd,
			"button-small": small,
			"button-small-ios": smallIos,
			"button-small-md": smallMd,
			"button-raised": raised,
			"button-raised-ios": raisedIos,
			"button-raised-md": raisedMd,
			"button-active": active,
			"button-outline": outline,
			"button-outline-ios": outlineIos,
			"button-outline-md": outlineMd,
			"button-preloader": preloader,
			"button-loading": loading,
			disabled
		}, colorClasses(restProps), routerClasses(restProps), actionsClasses(restProps)));
		const tagName = derived(() => type === "submit" || type === "reset" || type === "button" ? "button" : "a");
		const icon = derived(() => useIcon(restProps));
		if (tagName() === "button") {
			$$renderer.push(`<!--[0--><button${attributes({
				class: clsx(classes()),
				...attrs()
			})}>`);
			if (preloader) {
				$$renderer.push("<!--[0-->");
				Preloader($$renderer, {
					size: preloaderSize,
					color: preloaderColor
				});
				$$renderer.push(`<!----> <span>`);
				if (icon()) {
					$$renderer.push("<!--[0-->");
					Use_icon($$renderer, { icon: icon() });
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (typeof text !== "undefined") $$renderer.push(`<!--[0--><span>${escape_html(plainText(text))}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				children?.($$renderer);
				$$renderer.push(`<!----></span>`);
			} else {
				$$renderer.push("<!--[-1-->");
				if (icon()) {
					$$renderer.push("<!--[0-->");
					Use_icon($$renderer, { icon: icon() });
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (typeof text !== "undefined") $$renderer.push(`<!--[0--><span>${escape_html(plainText(text))}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			}
			$$renderer.push(`<!--]--></button>`);
		} else {
			$$renderer.push(`<!--[-1--><a${attributes({
				class: clsx(classes()),
				...attrs()
			})}>`);
			if (preloader) {
				$$renderer.push("<!--[0-->");
				Preloader($$renderer, {
					size: preloaderSize,
					color: preloaderColor
				});
				$$renderer.push(`<!----> <span>`);
				if (icon()) {
					$$renderer.push("<!--[0-->");
					Use_icon($$renderer, { icon: icon() });
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (typeof text !== "undefined") $$renderer.push(`<!--[0--><span>${escape_html(plainText(text))}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				children?.($$renderer);
				$$renderer.push(`<!----></span>`);
			} else {
				$$renderer.push("<!--[-1-->");
				if (icon()) {
					$$renderer.push("<!--[0-->");
					Use_icon($$renderer, { icon: icon() });
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (typeof text !== "undefined") $$renderer.push(`<!--[0--><span>${escape_html(plainText(text))}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			}
			$$renderer.push(`<!--]--></a>`);
		}
		$$renderer.push(`<!--]-->`);
	});
}
function Card_content($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, padding = true, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "card-content", { "card-content-padding": padding }, colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Card_footer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "card-footer", colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Card_header($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "card-header", colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Card($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, title = void 0, raised = false, outline = false, outlineIos = false, outlineMd = false, headerDivider = false, footerDivider = false, expandable = false, expandableAnimateWidth = false, expandableOpened = false, animate = void 0, hideNavbarOnOpen = void 0, hideToolbarOnOpen = void 0, hideStatusbarOnOpen = void 0, scrollableEl = void 0, swipeToClose = void 0, closeByBackdropClick = void 0, backdrop = void 0, backdropEl = void 0, padding = true, children, header, content, footer, $$slots, $$events, ...restProps } = $$props;
		let el = null;
		const classes = derived(() => classNames(className, "card", {
			"card-outline": outline,
			"card-outline-ios": outlineIos,
			"card-outline-md": outlineMd,
			"card-raised": raised,
			"card-header-divider": headerDivider,
			"card-footer-divider": footerDivider,
			"card-expandable": expandable,
			"card-expandable-animate-width": expandableAnimateWidth
		}, colorClasses(restProps)));
		function onBeforeOpen(cardEl, prevent) {
			if (cardEl !== el) return;
			restProps.oncardbeforeopen?.(el, prevent);
			restProps.onCardBeforeOpen?.(el, prevent);
		}
		function onOpen(cardEl) {
			if (cardEl !== el) return;
			restProps.oncardopen?.(el);
			restProps.onCardOpen?.(el);
			expandableOpened = true;
		}
		function onOpened(cardEl, pageEl) {
			if (cardEl !== el) return;
			restProps.oncardopened?.(el, pageEl);
			restProps.onCardOpened?.(el, pageEl);
		}
		function onClose(cardEl) {
			if (cardEl !== el) return;
			restProps.oncardclose?.(el);
			restProps.onCardClose?.(el);
		}
		function onClosed(cardEl, pageEl) {
			if (cardEl !== el) return;
			restProps.oncardclosed?.(el, pageEl);
			restProps.onCardClosed?.(el, pageEl);
			expandableOpened = false;
		}
		onDestroy(() => {
			if (!expandable) return;
			if (!app.f7 || true) return;
			app.f7.off("cardBeforeOpen", onBeforeOpen);
			app.f7.off("cardOpen", onOpen);
			app.f7.off("cardOpened", onOpened);
			app.f7.off("cardClose", onClose);
			app.f7.off("cardClosed", onClosed);
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			"data-animate": typeof animate === "undefined" ? animate : animate.toString(),
			"data-hide-navbar-on-open": typeof hideNavbarOnOpen === "undefined" ? hideNavbarOnOpen : hideNavbarOnOpen.toString(),
			"data-hide-toolbar-on-open": typeof hideToolbarOnOpen === "undefined" ? hideToolbarOnOpen : hideToolbarOnOpen.toString(),
			"data-hide-statusbar-on-open": typeof hideStatusbarOnOpen === "undefined" ? hideStatusbarOnOpen : hideStatusbarOnOpen.toString(),
			"data-scrollable-el": scrollableEl,
			"data-swipe-to-close": typeof swipeToClose === "undefined" ? swipeToClose : swipeToClose.toString(),
			"data-close-by-backdrop-click": typeof closeByBackdropClick === "undefined" ? closeByBackdropClick : closeByBackdropClick.toString(),
			"data-backdrop": typeof backdrop === "undefined" ? backdrop : backdrop.toString(),
			"data-backdrop-el": backdropEl,
			...restProps
		})}>`);
		if (typeof title !== "undefined" || typeof header !== "undefined") {
			$$renderer.push("<!--[0-->");
			Card_header($$renderer, {
				children: ($$renderer) => {
					$$renderer.push(`<!---->${escape_html(plainText(title))} `);
					if (typeof header === "function") {
						$$renderer.push("<!--[0-->");
						header?.($$renderer);
						$$renderer.push(`<!---->`);
					} else if (typeof header !== "undefined") $$renderer.push(`<!--[1-->${escape_html(header)}`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (typeof content !== "undefined" || typeof content !== "undefined") {
			$$renderer.push("<!--[0-->");
			Card_content($$renderer, {
				padding,
				children: ($$renderer) => {
					if (typeof content === "function") {
						$$renderer.push("<!--[0-->");
						content?.($$renderer);
						$$renderer.push(`<!---->`);
					} else if (typeof content !== "undefined") $$renderer.push(`<!--[1-->${escape_html(content)}`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (typeof footer !== "undefined" || typeof footer !== "undefined") {
			$$renderer.push("<!--[0-->");
			Card_footer($$renderer, {
				children: ($$renderer) => {
					if (typeof footer === "function") {
						$$renderer.push("<!--[0-->");
						footer?.($$renderer);
						$$renderer.push(`<!---->`);
					} else if (typeof footer !== "undefined") $$renderer.push(`<!--[1-->${escape_html(footer)}`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
var useSmartSelect = (props, setInstance, getEl) => {
	let f7SmartSelect;
	onDestroy(() => {
		if (f7SmartSelect && f7SmartSelect.destroy) f7SmartSelect.destroy();
		f7SmartSelect = null;
		setInstance(f7SmartSelect);
	});
};
function Link($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, disabled = false, noLinkClass = false, text = void 0, tabLink = void 0, tabLinkActive = false, tabbarLabel = false, iconOnly = false, badge = void 0, badgeColor = void 0, href = "#", target = void 0, tooltip = void 0, tooltipTrigger = void 0, routeProps = void 0, smartSelect = false, smartSelectParams = void 0, children, $$slots, $$events, ...restProps } = $$props;
		let el = void 0;
		let f7SmartSelect;
		function smartSelectInstance() {
			return f7SmartSelect;
		}
		const TabbarContext = getContext("TabbarContext") || (() => ({ value: {} }));
		const isTabbarIcons = derived(() => tabbarLabel || TabbarContext().value.tabbarHasIcons);
		const hrefComputed = derived(() => href === true ? "#" : href || void 0);
		const attrs = derived(() => extend({
			href: hrefComputed(),
			target,
			"data-tab": isStringProp(tabLink) && tabLink || void 0,
			...restProps,
			"aria-disabled": disabled || restProps["aria-disabled"],
			tabindex: disabled ? -1 : restProps.tabindex
		}, routerAttrs(restProps), actionsAttrs(restProps)));
		const hasDefaultSlots = derived(() => children);
		const iconOnlyComputed = derived(() => iconOnly || !text && !hasDefaultSlots());
		const classes = derived(() => classNames(className, {
			disabled,
			link: !(noLinkClass || isTabbarIcons()),
			"icon-only": iconOnlyComputed(),
			"tab-link": tabLink || tabLink === "",
			"tab-link-active": tabLinkActive,
			"smart-select": smartSelect
		}, colorClasses(restProps), routerClasses(restProps), actionsClasses(restProps)));
		const icon = derived(() => useIcon(restProps));
		useSmartSelect({
			smartSelect,
			smartSelectParams
		}, (instance) => {
			f7SmartSelect = instance;
		}, () => el);
		$$renderer.push(`<a${attributes({
			class: clsx(classes()),
			...attrs()
		})}>`);
		if (icon()) {
			$$renderer.push("<!--[0-->");
			Use_icon($$renderer, { icon: icon() });
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----> `);
		if (typeof text !== "undefined" || typeof badge !== "undefined") {
			$$renderer.push(`<!--[0--><span${attr_class("", void 0, { "tabbar-label": isTabbarIcons() })}>`);
			if (typeof text === "function") {
				$$renderer.push("<!--[0-->");
				text?.($$renderer);
				$$renderer.push(`<!---->`);
			} else if (typeof text !== "undefined") $$renderer.push(`<!--[1-->${escape_html(text)}`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (typeof badge !== "undefined") {
				$$renderer.push("<!--[0-->");
				Badge($$renderer, {
					color: badgeColor,
					children: ($$renderer) => {
						$$renderer.push(`<!---->${escape_html(badge)}`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></a>`);
		bind_props($$props, { smartSelectInstance });
	});
}
function Snippet_render($$renderer, $$props) {
	let { content } = $$props;
	if (typeof content === "function") {
		$$renderer.push("<!--[0-->");
		content?.($$renderer);
		$$renderer.push(`<!---->`);
	} else if (typeof content !== "undefined") $$renderer.push(`<!--[1-->${escape_html(content)}`);
	else $$renderer.push("<!--[-1-->");
	$$renderer.push(`<!--]-->`);
}
function List_item($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, title = void 0, text = void 0, media = void 0, subtitle = void 0, header = void 0, footer = void 0, tooltip = void 0, tooltipTrigger = void 0, link = void 0, tabLink = void 0, tabLinkActive = false, selected = false, href = void 0, target = void 0, after = void 0, badge = void 0, badgeColor = void 0, mediaItem = false, mediaList = false, groupTitle = false, swipeout = false, swipeoutOpened = false, sortable = void 0, sortableOpposite = void 0, accordionItem = false, accordionItemOpened = false, smartSelect = false, smartSelectParams = void 0, noChevron = void 0, chevronCenter = void 0, checkbox = void 0, checkboxIcon = void 0, radio = void 0, radioIcon = void 0, checked = void 0, indeterminate = void 0, name = void 0, value = void 0, readonly = void 0, required = void 0, disabled = void 0, virtualListIndex = void 0, routeProps = void 0, contentStart, content, contentEnd, innerStart, inner, innerEnd, root, rootStart, rootEnd, beforeTitle, afterTitle, afterStart, afterEnd, children, $$slots, $$events, ...restProps } = $$props;
		let el = void 0;
		function smartSelectInstance() {}
		const ListContext = getContext("ListContext") || (() => ({ value: {} }));
		const isMedia = derived(() => mediaList || mediaItem || ListContext().value.listIsMedia);
		const isSortable = derived(() => sortable === true || sortable === false ? sortable : ListContext().value.listIsSortable);
		const isSortableOpposite = derived(() => sortableOpposite || ListContext().value.listIsSortableOpposite);
		const isSimple = derived(() => ListContext().value.listIsSimple);
		const liClasses = derived(() => classNames(className, {
			"list-group-title": groupTitle,
			"media-item": isMedia(),
			swipeout,
			"accordion-item": accordionItem,
			"accordion-item-opened": accordionItemOpened,
			disabled: disabled && !(radio || checkbox),
			"no-chevron": noChevron,
			"chevron-center": chevronCenter,
			"disallow-sorting": sortable === false
		}, colorClasses(restProps)));
		const contentClasses = derived(() => classNames(className, "item-content", {
			"item-checkbox": checkbox,
			"item-radio": radio,
			"item-checkbox-icon-start": checkbox && checkboxIcon === "start",
			"item-checkbox-icon-end": checkbox && checkboxIcon === "end",
			"item-radio-icon-start": radio && radioIcon === "start",
			"item-radio-icon-end": radio && radioIcon === "end"
		}, colorClasses(restProps)));
		const linkClasses = derived(() => classNames({
			"item-link": true,
			"smart-select": smartSelect,
			"tab-link": tabLink || tabLink === "",
			"tab-link-active": tabLinkActive,
			"item-selected": selected
		}, routerClasses(restProps), actionsClasses(restProps)));
		const linkAttrs = derived(() => ({
			href: href === false ? void 0 : link === true ? href || "" : link || href,
			target,
			"data-tab": isStringProp(tabLink) && tabLink || void 0,
			...routerAttrs(restProps),
			...actionsAttrs(restProps)
		}));
		const isLink = derived(() => link || href || smartSelect || accordionItem);
		const hasMedia = derived(() => typeof media !== "undefined");
		const hasTitle = derived(() => typeof title !== "undefined");
		const hasHeader = derived(() => typeof header !== "undefined");
		const hasFooter = derived(() => typeof footer !== "undefined");
		const hasSubtitle = derived(() => typeof subtitle !== "undefined");
		const hasText = derived(() => typeof text !== "undefined");
		const hasAfter = derived(() => typeof after !== "undefined" || typeof badge !== "undefined");
		function onSwipeoutOverswipeEnter(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutOverswipeEnter?.(event);
			restProps.onswipeoutoverswipeenter?.(event);
		}
		function onSwipeoutOverswipeExit(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutOverswipeExit?.(event);
			restProps.onswipeoutoverswipeexit?.(event);
		}
		function onSwipeoutDeleted(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutDeleted?.(event);
			restProps.onswipeoutdeleted?.(event);
		}
		function onSwipeoutDelete(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutDelete?.(event);
			restProps.onswipeoutdelete?.(event);
		}
		function onSwipeoutClose(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutClose?.(event);
			restProps.onswipeoutclose?.(event);
		}
		function onSwipeoutClosed(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutClosed?.(event);
			restProps.onswipeoutclosed?.(event);
		}
		function onSwipeoutOpen(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutOpen?.(event);
			restProps.onswipeoutopen?.(event);
		}
		function onSwipeoutOpened(eventEl) {
			if (eventEl !== el) return;
			restProps.onSwipeoutOpened?.(event);
			restProps.onswipeoutopened?.(event);
		}
		function onSwipeout(eventEl, progress) {
			if (eventEl !== el) return;
			restProps.onSwipeout?.(progress);
			restProps.onswipeout?.(progress);
		}
		function onAccBeforeClose(eventEl, prevent) {
			if (eventEl !== el) return;
			restProps.onAccordionBeforeClose?.(prevent);
			restProps.onaccordionbeforeclose?.(prevent);
		}
		function onAccClose(eventEl) {
			if (eventEl !== el) return;
			restProps.onAccordionClose?.(event);
			restProps.onaccordionclose?.(event);
		}
		function onAccClosed(eventEl) {
			if (eventEl !== el) return;
			restProps.onAccordionClosed?.(event);
			restProps.onaccordionclosed?.(event);
		}
		function onAccBeforeOpen(eventEl, prevent) {
			if (eventEl !== el) return;
			restProps.onAccordionBeforeOpen?.(prevent);
			restProps.onaccordionbeforeopen?.(prevent);
		}
		function onAccOpen(eventEl) {
			if (eventEl !== el) return;
			restProps.onAccordionOpen?.(event);
			restProps.onaccordionopen?.(event);
		}
		function onAccOpened(eventEl) {
			if (eventEl !== el) return;
			restProps.onAccordionOpened?.(event);
			restProps.onaccordionopened?.(event);
		}
		onDestroy(() => {
			if (!app.f7) return;
			if (swipeout) {
				app.f7.off("swipeoutOpen", onSwipeoutOpen);
				app.f7.off("swipeoutOpened", onSwipeoutOpened);
				app.f7.off("swipeoutClose", onSwipeoutClose);
				app.f7.off("swipeoutClosed", onSwipeoutClosed);
				app.f7.off("swipeoutDelete", onSwipeoutDelete);
				app.f7.off("swipeoutDeleted", onSwipeoutDeleted);
				app.f7.off("swipeoutOverswipeEnter", onSwipeoutOverswipeEnter);
				app.f7.off("swipeoutOverswipeExit", onSwipeoutOverswipeExit);
				app.f7.off("swipeout", onSwipeout);
			}
			if (accordionItem) {
				app.f7.off("accordionBeforeOpen", onAccBeforeOpen);
				app.f7.off("accordionOpen", onAccOpen);
				app.f7.off("accordionOpened", onAccOpened);
				app.f7.off("accordionBeforeClose", onAccBeforeClose);
				app.f7.off("accordionClose", onAccClose);
				app.f7.off("accordionClosed", onAccClosed);
			}
		});
		if (groupTitle) {
			$$renderer.push(`<!--[0--><li${attributes({
				class: clsx(liClasses()),
				"data-virtual-list-index": virtualListIndex,
				...restProps
			})}><span>`);
			Snippet_render($$renderer, { content: title });
			$$renderer.push(`<!----> `);
			children?.($$renderer);
			$$renderer.push(`<!----></span></li>`);
		} else if (isSimple()) {
			$$renderer.push(`<!--[1--><li${attributes({
				class: clsx(liClasses()),
				"data-virtual-list-index": virtualListIndex,
				...restProps
			})}>`);
			Snippet_render($$renderer, { content: title });
			$$renderer.push(`<!----> `);
			children?.($$renderer);
			$$renderer.push(`<!----></li>`);
		} else {
			$$renderer.push(`<!--[-1--><li${attributes({
				class: clsx(liClasses()),
				"data-virtual-list-index": virtualListIndex,
				...restProps
			})}>`);
			Snippet_render($$renderer, { content: rootStart });
			$$renderer.push(`<!----> `);
			if (swipeout) {
				$$renderer.push(`<!--[0--><div class="swipeout-content">`);
				if (isLink()) {
					$$renderer.push(`<!--[0--><a${attributes({
						class: clsx(linkClasses()),
						...linkAttrs()
					})}><div${attr_class(clsx(contentClasses()))}>`);
					Snippet_render($$renderer, { content: contentStart });
					$$renderer.push(`<!----> `);
					if (isSortable() && sortable !== false && isSortableOpposite()) $$renderer.push(`<!--[0--><div class="sortable-handler"></div>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (hasMedia()) {
						$$renderer.push(`<!--[0--><div class="item-media">`);
						if (typeof media === "function") {
							$$renderer.push("<!--[0-->");
							media?.($$renderer);
							$$renderer.push(`<!---->`);
						} else if (typeof media === "string") $$renderer.push(`<!--[1--><img${attr("src", media)}/>`);
						else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> <div class="item-inner">`);
					Snippet_render($$renderer, { content: innerStart });
					$$renderer.push(`<!----> `);
					if (isMedia()) {
						$$renderer.push("<!--[0-->");
						if (hasHeader()) {
							$$renderer.push(`<!--[0--><div class="item-header">`);
							Snippet_render($$renderer, { content: header });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="item-title-row">`);
						Snippet_render($$renderer, { content: beforeTitle });
						$$renderer.push(`<!----> `);
						if (hasTitle()) {
							$$renderer.push(`<!--[0--><div class="item-title">`);
							Snippet_render($$renderer, { content: title });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterTitle });
						$$renderer.push(`<!----> `);
						if (hasAfter()) {
							$$renderer.push(`<!--[0--><div class="item-after">`);
							Snippet_render($$renderer, { content: afterStart });
							$$renderer.push(`<!----> `);
							Snippet_render($$renderer, { content: after });
							$$renderer.push(`<!----> `);
							if (typeof badge !== "undefined") {
								$$renderer.push("<!--[0-->");
								Badge($$renderer, {
									color: badgeColor,
									children: ($$renderer) => {
										Snippet_render($$renderer, { content: badge });
									},
									$$slots: { default: true }
								});
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterEnd });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div> `);
						if (hasSubtitle()) {
							$$renderer.push(`<!--[0--><div class="item-subtitle">`);
							Snippet_render($$renderer, { content: subtitle });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (hasText()) {
							$$renderer.push(`<!--[0--><div class="item-text">`);
							Snippet_render($$renderer, { content: text });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: inner });
						$$renderer.push(`<!----> `);
						if (!(swipeout || accordionItem)) {
							$$renderer.push("<!--[0-->");
							children?.($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (hasFooter()) {
							$$renderer.push(`<!--[0--><div class="item-footer">`);
							Snippet_render($$renderer, { content: footer });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					} else {
						$$renderer.push("<!--[-1-->");
						Snippet_render($$renderer, { content: beforeTitle });
						$$renderer.push(`<!----> `);
						if (hasTitle() || hasHeader() || hasFooter()) {
							$$renderer.push(`<!--[0--><div class="item-title">`);
							if (hasHeader()) {
								$$renderer.push(`<!--[0--><div class="item-header">`);
								Snippet_render($$renderer, { content: header });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: title });
							$$renderer.push(`<!----> `);
							if (hasFooter()) {
								$$renderer.push(`<!--[0--><div class="item-footer">`);
								Snippet_render($$renderer, { content: footer });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterTitle });
						$$renderer.push(`<!----> `);
						if (hasAfter()) {
							$$renderer.push(`<!--[0--><div class="item-after">`);
							Snippet_render($$renderer, { content: afterStart });
							$$renderer.push(`<!----> `);
							Snippet_render($$renderer, { content: after });
							$$renderer.push(`<!----> `);
							if (typeof badge !== "undefined") {
								$$renderer.push("<!--[0-->");
								Badge($$renderer, {
									color: badgeColor,
									children: ($$renderer) => {
										Snippet_render($$renderer, { content: badge });
									},
									$$slots: { default: true }
								});
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterEnd });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: inner });
						$$renderer.push(`<!----> `);
						if (!(swipeout || accordionItem)) {
							$$renderer.push("<!--[0-->");
							children?.($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					}
					$$renderer.push(`<!--]--> `);
					Snippet_render($$renderer, { content: innerEnd });
					$$renderer.push(`<!----></div> `);
					Snippet_render($$renderer, { content });
					$$renderer.push(`<!----> `);
					Snippet_render($$renderer, { content: contentEnd });
					$$renderer.push(`<!----></div></a>`);
				} else {
					$$renderer.push("<!--[-1-->");
					if (checkbox || radio) {
						$$renderer.push(`<!--[0--><label${attr_class(clsx(contentClasses()))}>`);
						Snippet_render($$renderer, { content: contentStart });
						$$renderer.push(`<!----> `);
						if (isSortable() && sortable !== false && isSortableOpposite()) $$renderer.push(`<!--[0--><div class="sortable-handler"></div>`);
						else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <input${attr("value", typeof value === "undefined" ? "" : value)}${attr("name", name)}${attr("checked", checked, true)}${attr("readonly", readonly, true)}${attr("disabled", disabled, true)}${attr("required", required, true)}${attr("type", radio ? "radio" : "checkbox")}/> <i${attr_class(`icon icon-${radio ? "radio" : "checkbox"}`)}></i> `);
						if (hasMedia()) {
							$$renderer.push(`<!--[0--><div class="item-media">`);
							if (typeof media === "function") {
								$$renderer.push("<!--[0-->");
								media?.($$renderer);
								$$renderer.push(`<!---->`);
							} else if (typeof media === "string") $$renderer.push(`<!--[1--><img${attr("src", media)}/>`);
							else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="item-inner">`);
						Snippet_render($$renderer, { content: innerStart });
						$$renderer.push(`<!----> `);
						if (isMedia()) {
							$$renderer.push("<!--[0-->");
							if (hasHeader()) {
								$$renderer.push(`<!--[0--><div class="item-header">`);
								Snippet_render($$renderer, { content: header });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> <div class="item-title-row">`);
							Snippet_render($$renderer, { content: beforeTitle });
							$$renderer.push(`<!----> `);
							if (hasTitle()) {
								$$renderer.push(`<!--[0--><div class="item-title">`);
								Snippet_render($$renderer, { content: title });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterTitle });
							$$renderer.push(`<!----> `);
							if (hasAfter()) {
								$$renderer.push(`<!--[0--><div class="item-after">`);
								Snippet_render($$renderer, { content: afterStart });
								$$renderer.push(`<!----> `);
								Snippet_render($$renderer, { content: after });
								$$renderer.push(`<!----> `);
								if (typeof badge !== "undefined") {
									$$renderer.push("<!--[0-->");
									Badge($$renderer, {
										color: badgeColor,
										children: ($$renderer) => {
											Snippet_render($$renderer, { content: badge });
										},
										$$slots: { default: true }
									});
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								Snippet_render($$renderer, { content: afterEnd });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div> `);
							if (hasSubtitle()) {
								$$renderer.push(`<!--[0--><div class="item-subtitle">`);
								Snippet_render($$renderer, { content: subtitle });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							if (hasText()) {
								$$renderer.push(`<!--[0--><div class="item-text">`);
								Snippet_render($$renderer, { content: text });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: inner });
							$$renderer.push(`<!----> `);
							if (!(swipeout || accordionItem)) {
								$$renderer.push("<!--[0-->");
								children?.($$renderer);
								$$renderer.push(`<!---->`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							if (hasFooter()) {
								$$renderer.push(`<!--[0--><div class="item-footer">`);
								Snippet_render($$renderer, { content: footer });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]-->`);
						} else {
							$$renderer.push("<!--[-1-->");
							Snippet_render($$renderer, { content: beforeTitle });
							$$renderer.push(`<!----> `);
							if (hasTitle() || hasHeader() || hasFooter()) {
								$$renderer.push(`<!--[0--><div class="item-title">`);
								if (hasHeader()) {
									$$renderer.push(`<!--[0--><div class="item-header">`);
									Snippet_render($$renderer, { content: header });
									$$renderer.push(`<!----></div>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								Snippet_render($$renderer, { content: title });
								$$renderer.push(`<!----> `);
								if (hasFooter()) {
									$$renderer.push(`<!--[0--><div class="item-footer">`);
									Snippet_render($$renderer, { content: footer });
									$$renderer.push(`<!----></div>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterTitle });
							$$renderer.push(`<!----> `);
							if (hasAfter()) {
								$$renderer.push(`<!--[0--><div class="item-after">`);
								Snippet_render($$renderer, { content: afterStart });
								$$renderer.push(`<!----> `);
								Snippet_render($$renderer, { content: after });
								$$renderer.push(`<!----> `);
								if (typeof badge !== "undefined") {
									$$renderer.push("<!--[0-->");
									Badge($$renderer, {
										color: badgeColor,
										children: ($$renderer) => {
											Snippet_render($$renderer, { content: badge });
										},
										$$slots: { default: true }
									});
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								Snippet_render($$renderer, { content: afterEnd });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: inner });
							$$renderer.push(`<!----> `);
							if (!(swipeout || accordionItem)) {
								$$renderer.push("<!--[0-->");
								children?.($$renderer);
								$$renderer.push(`<!---->`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]-->`);
						}
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: innerEnd });
						$$renderer.push(`<!----></div> `);
						Snippet_render($$renderer, { content });
						$$renderer.push(`<!----> `);
						Snippet_render($$renderer, { content: contentEnd });
						$$renderer.push(`<!----></label>`);
					} else {
						$$renderer.push(`<!--[-1--><div${attr_class(clsx(contentClasses()))}>`);
						Snippet_render($$renderer, { content: contentStart });
						$$renderer.push(`<!----> `);
						if (isSortable() && sortable !== false && isSortableOpposite()) $$renderer.push(`<!--[0--><div class="sortable-handler"></div>`);
						else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (hasMedia()) {
							$$renderer.push(`<!--[0--><div class="item-media">`);
							if (typeof media === "function") {
								$$renderer.push("<!--[0-->");
								media?.($$renderer);
								$$renderer.push(`<!---->`);
							} else if (typeof media === "string") $$renderer.push(`<!--[1--><img${attr("src", media)}/>`);
							else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="item-inner">`);
						Snippet_render($$renderer, { content: innerStart });
						$$renderer.push(`<!----> `);
						if (isMedia()) {
							$$renderer.push("<!--[0-->");
							if (hasHeader()) {
								$$renderer.push(`<!--[0--><div class="item-header">`);
								Snippet_render($$renderer, { content: header });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> <div class="item-title-row">`);
							Snippet_render($$renderer, { content: beforeTitle });
							$$renderer.push(`<!----> `);
							if (hasTitle()) {
								$$renderer.push(`<!--[0--><div class="item-title">`);
								Snippet_render($$renderer, { content: title });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterTitle });
							$$renderer.push(`<!----> `);
							if (hasAfter()) {
								$$renderer.push(`<!--[0--><div class="item-after">`);
								Snippet_render($$renderer, { content: afterStart });
								$$renderer.push(`<!----> `);
								Snippet_render($$renderer, { content: after });
								$$renderer.push(`<!----> `);
								if (typeof badge !== "undefined") {
									$$renderer.push("<!--[0-->");
									Badge($$renderer, {
										color: badgeColor,
										children: ($$renderer) => {
											Snippet_render($$renderer, { content: badge });
										},
										$$slots: { default: true }
									});
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								Snippet_render($$renderer, { content: afterEnd });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div> `);
							if (hasSubtitle()) {
								$$renderer.push(`<!--[0--><div class="item-subtitle">`);
								Snippet_render($$renderer, { content: subtitle });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							if (hasText()) {
								$$renderer.push(`<!--[0--><div class="item-text">`);
								Snippet_render($$renderer, { content: text });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: inner });
							$$renderer.push(`<!----> `);
							if (!(swipeout || accordionItem)) {
								$$renderer.push("<!--[0-->");
								children?.($$renderer);
								$$renderer.push(`<!---->`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							if (hasFooter()) {
								$$renderer.push(`<!--[0--><div class="item-footer">`);
								Snippet_render($$renderer, { content: footer });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]-->`);
						} else {
							$$renderer.push("<!--[-1-->");
							Snippet_render($$renderer, { content: beforeTitle });
							$$renderer.push(`<!----> `);
							if (hasTitle() || hasHeader() || hasFooter()) {
								$$renderer.push(`<!--[0--><div class="item-title">`);
								if (hasHeader()) {
									$$renderer.push(`<!--[0--><div class="item-header">`);
									Snippet_render($$renderer, { content: header });
									$$renderer.push(`<!----></div>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								Snippet_render($$renderer, { content: title });
								$$renderer.push(`<!----> `);
								if (hasFooter()) {
									$$renderer.push(`<!--[0--><div class="item-footer">`);
									Snippet_render($$renderer, { content: footer });
									$$renderer.push(`<!----></div>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterTitle });
							$$renderer.push(`<!----> `);
							if (hasAfter()) {
								$$renderer.push(`<!--[0--><div class="item-after">`);
								Snippet_render($$renderer, { content: afterStart });
								$$renderer.push(`<!----> `);
								Snippet_render($$renderer, { content: after });
								$$renderer.push(`<!----> `);
								if (typeof badge !== "undefined") {
									$$renderer.push("<!--[0-->");
									Badge($$renderer, {
										color: badgeColor,
										children: ($$renderer) => {
											Snippet_render($$renderer, { content: badge });
										},
										$$slots: { default: true }
									});
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								Snippet_render($$renderer, { content: afterEnd });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: inner });
							$$renderer.push(`<!----> `);
							if (!(swipeout || accordionItem)) {
								$$renderer.push("<!--[0-->");
								children?.($$renderer);
								$$renderer.push(`<!---->`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]-->`);
						}
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: innerEnd });
						$$renderer.push(`<!----></div> `);
						Snippet_render($$renderer, { content });
						$$renderer.push(`<!----> `);
						Snippet_render($$renderer, { content: contentEnd });
						$$renderer.push(`<!----></div>`);
					}
					$$renderer.push(`<!--]-->`);
				}
				$$renderer.push(`<!--]--></div>`);
			} else if (isLink()) {
				$$renderer.push(`<!--[1--><a${attributes({
					class: clsx(linkClasses()),
					...linkAttrs()
				})}><div${attr_class(clsx(contentClasses()))}>`);
				Snippet_render($$renderer, { content: contentStart });
				$$renderer.push(`<!----> `);
				if (isSortable() && sortable !== false && isSortableOpposite()) $$renderer.push(`<!--[0--><div class="sortable-handler"></div>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (hasMedia()) {
					$$renderer.push(`<!--[0--><div class="item-media">`);
					if (typeof media === "function") {
						$$renderer.push("<!--[0-->");
						media?.($$renderer);
						$$renderer.push(`<!---->`);
					} else if (typeof media === "string") $$renderer.push(`<!--[1--><img${attr("src", media)}/>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></div>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <div class="item-inner">`);
				Snippet_render($$renderer, { content: innerStart });
				$$renderer.push(`<!----> `);
				if (isMedia()) {
					$$renderer.push("<!--[0-->");
					if (hasHeader()) {
						$$renderer.push(`<!--[0--><div class="item-header">`);
						Snippet_render($$renderer, { content: header });
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> <div class="item-title-row">`);
					Snippet_render($$renderer, { content: beforeTitle });
					$$renderer.push(`<!----> `);
					if (hasTitle()) {
						$$renderer.push(`<!--[0--><div class="item-title">`);
						Snippet_render($$renderer, { content: title });
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					Snippet_render($$renderer, { content: afterTitle });
					$$renderer.push(`<!----> `);
					if (hasAfter()) {
						$$renderer.push(`<!--[0--><div class="item-after">`);
						Snippet_render($$renderer, { content: afterStart });
						$$renderer.push(`<!----> `);
						Snippet_render($$renderer, { content: after });
						$$renderer.push(`<!----> `);
						if (typeof badge !== "undefined") {
							$$renderer.push("<!--[0-->");
							Badge($$renderer, {
								color: badgeColor,
								children: ($$renderer) => {
									Snippet_render($$renderer, { content: badge });
								},
								$$slots: { default: true }
							});
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterEnd });
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></div> `);
					if (hasSubtitle()) {
						$$renderer.push(`<!--[0--><div class="item-subtitle">`);
						Snippet_render($$renderer, { content: subtitle });
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (hasText()) {
						$$renderer.push(`<!--[0--><div class="item-text">`);
						Snippet_render($$renderer, { content: text });
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					Snippet_render($$renderer, { content: inner });
					$$renderer.push(`<!----> `);
					if (!(swipeout || accordionItem)) {
						$$renderer.push("<!--[0-->");
						children?.($$renderer);
						$$renderer.push(`<!---->`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (hasFooter()) {
						$$renderer.push(`<!--[0--><div class="item-footer">`);
						Snippet_render($$renderer, { content: footer });
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				} else {
					$$renderer.push("<!--[-1-->");
					Snippet_render($$renderer, { content: beforeTitle });
					$$renderer.push(`<!----> `);
					if (hasTitle() || hasHeader() || hasFooter()) {
						$$renderer.push(`<!--[0--><div class="item-title">`);
						if (hasHeader()) {
							$$renderer.push(`<!--[0--><div class="item-header">`);
							Snippet_render($$renderer, { content: header });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: title });
						$$renderer.push(`<!----> `);
						if (hasFooter()) {
							$$renderer.push(`<!--[0--><div class="item-footer">`);
							Snippet_render($$renderer, { content: footer });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					Snippet_render($$renderer, { content: afterTitle });
					$$renderer.push(`<!----> `);
					if (hasAfter()) {
						$$renderer.push(`<!--[0--><div class="item-after">`);
						Snippet_render($$renderer, { content: afterStart });
						$$renderer.push(`<!----> `);
						Snippet_render($$renderer, { content: after });
						$$renderer.push(`<!----> `);
						if (typeof badge !== "undefined") {
							$$renderer.push("<!--[0-->");
							Badge($$renderer, {
								color: badgeColor,
								children: ($$renderer) => {
									Snippet_render($$renderer, { content: badge });
								},
								$$slots: { default: true }
							});
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterEnd });
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					Snippet_render($$renderer, { content: inner });
					$$renderer.push(`<!----> `);
					if (!(swipeout || accordionItem)) {
						$$renderer.push("<!--[0-->");
						children?.($$renderer);
						$$renderer.push(`<!---->`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				}
				$$renderer.push(`<!--]--> `);
				Snippet_render($$renderer, { content: innerEnd });
				$$renderer.push(`<!----></div> `);
				Snippet_render($$renderer, { content });
				$$renderer.push(`<!----> `);
				Snippet_render($$renderer, { content: contentEnd });
				$$renderer.push(`<!----></div></a>`);
			} else {
				$$renderer.push("<!--[-1-->");
				if (checkbox || radio) {
					$$renderer.push(`<!--[0--><label${attr_class(clsx(contentClasses()))}>`);
					Snippet_render($$renderer, { content: contentStart });
					$$renderer.push(`<!----> `);
					if (isSortable() && sortable !== false && isSortableOpposite()) $$renderer.push(`<!--[0--><div class="sortable-handler"></div>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> <input${attr("value", typeof value === "undefined" ? "" : value)}${attr("name", name)}${attr("checked", checked, true)}${attr("readonly", readonly, true)}${attr("disabled", disabled, true)}${attr("required", required, true)}${attr("type", radio ? "radio" : "checkbox")}/> <i${attr_class(`icon icon-${radio ? "radio" : "checkbox"}`)}></i> `);
					if (hasMedia()) {
						$$renderer.push(`<!--[0--><div class="item-media">`);
						if (typeof media === "function") {
							$$renderer.push("<!--[0-->");
							media?.($$renderer);
							$$renderer.push(`<!---->`);
						} else if (typeof media === "string") $$renderer.push(`<!--[1--><img${attr("src", media)}/>`);
						else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> <div class="item-inner">`);
					Snippet_render($$renderer, { content: innerStart });
					$$renderer.push(`<!----> `);
					if (isMedia()) {
						$$renderer.push("<!--[0-->");
						if (hasHeader()) {
							$$renderer.push(`<!--[0--><div class="item-header">`);
							Snippet_render($$renderer, { content: header });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="item-title-row">`);
						Snippet_render($$renderer, { content: beforeTitle });
						$$renderer.push(`<!----> `);
						if (hasTitle()) {
							$$renderer.push(`<!--[0--><div class="item-title">`);
							Snippet_render($$renderer, { content: title });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterTitle });
						$$renderer.push(`<!----> `);
						if (hasAfter()) {
							$$renderer.push(`<!--[0--><div class="item-after">`);
							Snippet_render($$renderer, { content: afterStart });
							$$renderer.push(`<!----> `);
							Snippet_render($$renderer, { content: after });
							$$renderer.push(`<!----> `);
							if (typeof badge !== "undefined") {
								$$renderer.push("<!--[0-->");
								Badge($$renderer, {
									color: badgeColor,
									children: ($$renderer) => {
										Snippet_render($$renderer, { content: badge });
									},
									$$slots: { default: true }
								});
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterEnd });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div> `);
						if (hasSubtitle()) {
							$$renderer.push(`<!--[0--><div class="item-subtitle">`);
							Snippet_render($$renderer, { content: subtitle });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (hasText()) {
							$$renderer.push(`<!--[0--><div class="item-text">`);
							Snippet_render($$renderer, { content: text });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: inner });
						$$renderer.push(`<!----> `);
						if (!(swipeout || accordionItem)) {
							$$renderer.push("<!--[0-->");
							children?.($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (hasFooter()) {
							$$renderer.push(`<!--[0--><div class="item-footer">`);
							Snippet_render($$renderer, { content: footer });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					} else {
						$$renderer.push("<!--[-1-->");
						Snippet_render($$renderer, { content: beforeTitle });
						$$renderer.push(`<!----> `);
						if (hasTitle() || hasHeader() || hasFooter()) {
							$$renderer.push(`<!--[0--><div class="item-title">`);
							if (hasHeader()) {
								$$renderer.push(`<!--[0--><div class="item-header">`);
								Snippet_render($$renderer, { content: header });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: title });
							$$renderer.push(`<!----> `);
							if (hasFooter()) {
								$$renderer.push(`<!--[0--><div class="item-footer">`);
								Snippet_render($$renderer, { content: footer });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterTitle });
						$$renderer.push(`<!----> `);
						if (hasAfter()) {
							$$renderer.push(`<!--[0--><div class="item-after">`);
							Snippet_render($$renderer, { content: afterStart });
							$$renderer.push(`<!----> `);
							Snippet_render($$renderer, { content: after });
							$$renderer.push(`<!----> `);
							if (typeof badge !== "undefined") {
								$$renderer.push("<!--[0-->");
								Badge($$renderer, {
									color: badgeColor,
									children: ($$renderer) => {
										Snippet_render($$renderer, { content: badge });
									},
									$$slots: { default: true }
								});
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterEnd });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: inner });
						$$renderer.push(`<!----> `);
						if (!(swipeout || accordionItem)) {
							$$renderer.push("<!--[0-->");
							children?.($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					}
					$$renderer.push(`<!--]--> `);
					Snippet_render($$renderer, { content: innerEnd });
					$$renderer.push(`<!----></div> `);
					Snippet_render($$renderer, { content });
					$$renderer.push(`<!----> `);
					Snippet_render($$renderer, { content: contentEnd });
					$$renderer.push(`<!----></label>`);
				} else {
					$$renderer.push(`<!--[-1--><div${attr_class(clsx(contentClasses()))}>`);
					Snippet_render($$renderer, { content: contentStart });
					$$renderer.push(`<!----> `);
					if (isSortable() && sortable !== false && isSortableOpposite()) $$renderer.push(`<!--[0--><div class="sortable-handler"></div>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (hasMedia()) {
						$$renderer.push(`<!--[0--><div class="item-media">`);
						if (typeof media === "function") {
							$$renderer.push("<!--[0-->");
							media?.($$renderer);
							$$renderer.push(`<!---->`);
						} else if (typeof media === "string") $$renderer.push(`<!--[1--><img${attr("src", media)}/>`);
						else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> <div class="item-inner">`);
					Snippet_render($$renderer, { content: innerStart });
					$$renderer.push(`<!----> `);
					if (isMedia()) {
						$$renderer.push("<!--[0-->");
						if (hasHeader()) {
							$$renderer.push(`<!--[0--><div class="item-header">`);
							Snippet_render($$renderer, { content: header });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="item-title-row">`);
						Snippet_render($$renderer, { content: beforeTitle });
						$$renderer.push(`<!----> `);
						if (hasTitle()) {
							$$renderer.push(`<!--[0--><div class="item-title">`);
							Snippet_render($$renderer, { content: title });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterTitle });
						$$renderer.push(`<!----> `);
						if (hasAfter()) {
							$$renderer.push(`<!--[0--><div class="item-after">`);
							Snippet_render($$renderer, { content: afterStart });
							$$renderer.push(`<!----> `);
							Snippet_render($$renderer, { content: after });
							$$renderer.push(`<!----> `);
							if (typeof badge !== "undefined") {
								$$renderer.push("<!--[0-->");
								Badge($$renderer, {
									color: badgeColor,
									children: ($$renderer) => {
										Snippet_render($$renderer, { content: badge });
									},
									$$slots: { default: true }
								});
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterEnd });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div> `);
						if (hasSubtitle()) {
							$$renderer.push(`<!--[0--><div class="item-subtitle">`);
							Snippet_render($$renderer, { content: subtitle });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (hasText()) {
							$$renderer.push(`<!--[0--><div class="item-text">`);
							Snippet_render($$renderer, { content: text });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: inner });
						$$renderer.push(`<!----> `);
						if (!(swipeout || accordionItem)) {
							$$renderer.push("<!--[0-->");
							children?.($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (hasFooter()) {
							$$renderer.push(`<!--[0--><div class="item-footer">`);
							Snippet_render($$renderer, { content: footer });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					} else {
						$$renderer.push("<!--[-1-->");
						Snippet_render($$renderer, { content: beforeTitle });
						$$renderer.push(`<!----> `);
						if (hasTitle() || hasHeader() || hasFooter()) {
							$$renderer.push(`<!--[0--><div class="item-title">`);
							if (hasHeader()) {
								$$renderer.push(`<!--[0--><div class="item-header">`);
								Snippet_render($$renderer, { content: header });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: title });
							$$renderer.push(`<!----> `);
							if (hasFooter()) {
								$$renderer.push(`<!--[0--><div class="item-footer">`);
								Snippet_render($$renderer, { content: footer });
								$$renderer.push(`<!----></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: afterTitle });
						$$renderer.push(`<!----> `);
						if (hasAfter()) {
							$$renderer.push(`<!--[0--><div class="item-after">`);
							Snippet_render($$renderer, { content: afterStart });
							$$renderer.push(`<!----> `);
							Snippet_render($$renderer, { content: after });
							$$renderer.push(`<!----> `);
							if (typeof badge !== "undefined") {
								$$renderer.push("<!--[0-->");
								Badge($$renderer, {
									color: badgeColor,
									children: ($$renderer) => {
										Snippet_render($$renderer, { content: badge });
									},
									$$slots: { default: true }
								});
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Snippet_render($$renderer, { content: afterEnd });
							$$renderer.push(`<!----></div>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Snippet_render($$renderer, { content: inner });
						$$renderer.push(`<!----> `);
						if (!(swipeout || accordionItem)) {
							$$renderer.push("<!--[0-->");
							children?.($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					}
					$$renderer.push(`<!--]--> `);
					Snippet_render($$renderer, { content: innerEnd });
					$$renderer.push(`<!----></div> `);
					Snippet_render($$renderer, { content });
					$$renderer.push(`<!----> `);
					Snippet_render($$renderer, { content: contentEnd });
					$$renderer.push(`<!----></div>`);
				}
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--> `);
			if (isSortable() && sortable !== false && !isSortableOpposite()) $$renderer.push(`<!--[0--><div class="sortable-handler"></div>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (swipeout || accordionItem) {
				$$renderer.push("<!--[0-->");
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			Snippet_render($$renderer, { content: root });
			$$renderer.push(`<!----> `);
			Snippet_render($$renderer, { content: rootStart });
			$$renderer.push(`<!----></li>`);
		}
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { smartSelectInstance });
	});
}
function List($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, ul = true, inset = false, insetIos = false, insetMd = false, xsmallInset = false, xsmallInsetIos = false, xsmallInsetMd = false, smallInset = false, smallInsetIos = false, smallInsetMd = false, mediumInset = false, mediumInsetIos = false, mediumInsetMd = false, largeInset = false, largeInsetIos = false, largeInsetMd = false, xlargeInset = false, xlargeInsetIos = false, xlargeInsetMd = false, strong = false, strongIos = false, strongMd = false, outline = false, outlineIos = false, outlineMd = false, dividers = false, dividersIos = false, dividersMd = false, mediaList = false, sortable = false, sortableTapHold = false, sortableEnabled = false, sortableMoveElements = void 0, sortableOpposite = false, accordionList = false, accordionOpposite = false, contactsList = false, simpleList = false, linksList = false, menuList = false, noChevron = false, chevronCenter = false, tab = false, tabActive = false, form = false, formStoreData = false, virtualList = false, virtualListParams = void 0, children, list, beforeList, afterList, $$slots, $$events, ...restProps } = $$props;
		let el = null;
		let f7VirtualList;
		function virtualListInstance() {
			return f7VirtualList;
		}
		const hasUlSlots = derived(() => children || list);
		const classes = derived(() => classNames(className, "list", {
			inset,
			"inset-ios": insetIos,
			"inset-md": insetMd,
			"xsmall-inset": xsmallInset,
			"xsmall-inset-ios": xsmallInsetIos,
			"xsmall-inset-md": xsmallInsetMd,
			"small-inset": smallInset,
			"small-inset-ios": smallInsetIos,
			"small-inset-md": smallInsetMd,
			"medium-inset": mediumInset,
			"medium-inset-ios": mediumInsetIos,
			"medium-inset-md": mediumInsetMd,
			"large-inset": largeInset,
			"large-inset-ios": largeInsetIos,
			"large-inset-md": largeInsetMd,
			"xlarge-inset": xlargeInset,
			"xlarge-inset-ios": xlargeInsetIos,
			"xlarge-inset-md": xlargeInsetMd,
			"list-strong": strong,
			"list-strong-ios": strongIos,
			"list-strong-md": strongMd,
			"list-outline": outline,
			"list-outline-ios": outlineIos,
			"list-outline-md": outlineMd,
			"list-dividers": dividers,
			"list-dividers-ios": dividersIos,
			"list-dividers-md": dividersMd,
			"media-list": mediaList,
			"simple-list": simpleList,
			"links-list": linksList,
			"menu-list": menuList,
			sortable,
			"sortable-tap-hold": sortableTapHold,
			"sortable-enabled": sortableEnabled,
			"sortable-opposite": sortableOpposite,
			"accordion-list": accordionList,
			"accordion-opposite": accordionOpposite,
			"contacts-list": contactsList,
			"virtual-list": virtualList,
			tab,
			"tab-active": tabActive,
			"form-store-data": formStoreData,
			"no-chevron": noChevron,
			"chevron-center": chevronCenter
		}, colorClasses(restProps)));
		setContext("ListContext", () => ({ value: {
			listIsMedia: mediaList,
			listIsSimple: simpleList,
			listIsSortable: sortable,
			listIsSortableOpposite: sortableOpposite
		} }));
		function onSortableEnable(sortableEl) {
			if (sortableEl !== el) return;
			restProps.onSortableEnable?.(sortableEl);
			restProps.onsortableenable?.(sortableEl);
		}
		function onSortableDisable(sortableEl) {
			if (sortableEl !== el) return;
			restProps.onSortableDisable?.(sortableEl);
			restProps.onsortabledisable?.(sortableEl);
		}
		function onSortableSort(listItemEl, sortData, listEl) {
			if (listEl !== el) return;
			restProps.onSortableSort?.(sortData);
			restProps.onsortablesort?.(sortData);
		}
		function onSortableMove(listItemEl, listEl) {
			if (listEl !== el) return;
			restProps.onSortableMove?.(listItemEl, listEl);
			restProps.onsortablemove?.(listItemEl, listEl);
		}
		useTab(() => el, restProps);
		onDestroy(() => {
			if (!app.f7) return;
			app.f7.off("sortableEnable", onSortableEnable);
			app.f7.off("sortableDisable", onSortableDisable);
			app.f7.off("sortableSort", onSortableSort);
			app.f7.off("sortableMove", onSortableMove);
			if (f7VirtualList && f7VirtualList.destroy) {
				f7VirtualList.destroy();
				f7VirtualList = null;
			}
		});
		if (form) {
			$$renderer.push(`<!--[0--><form${attributes({
				class: clsx(classes()),
				"data-sortable-move-elements": typeof sortableMoveElements !== "undefined" ? sortableMoveElements.toString() : void 0,
				...restProps
			})}>`);
			beforeList?.($$renderer);
			$$renderer.push(`<!----> `);
			if (hasUlSlots() && ul) {
				$$renderer.push(`<!--[0--><ul>`);
				list?.($$renderer);
				$$renderer.push(`<!----> `);
				children?.($$renderer);
				$$renderer.push(`<!----></ul>`);
			} else {
				$$renderer.push("<!--[-1-->");
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			}
			$$renderer.push(`<!--]--> `);
			afterList?.($$renderer);
			$$renderer.push(`<!----></form>`);
		} else {
			$$renderer.push(`<!--[-1--><div${attributes({
				class: clsx(classes()),
				"data-sortable-move-elements": typeof sortableMoveElements !== "undefined" ? sortableMoveElements.toString() : void 0,
				...restProps
			})}>`);
			beforeList?.($$renderer);
			$$renderer.push(`<!----> `);
			if (hasUlSlots() && ul) {
				$$renderer.push(`<!--[0--><ul>`);
				list?.($$renderer);
				$$renderer.push(`<!----> `);
				children?.($$renderer);
				$$renderer.push(`<!----></ul>`);
			} else {
				$$renderer.push("<!--[-1-->");
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			}
			$$renderer.push(`<!--]--> `);
			afterList?.($$renderer);
			$$renderer.push(`<!----></div>`);
		}
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { virtualListInstance });
	});
}
function Nav_left($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, children, backLink, backLinkUrl, backLinkForce, backLinkShowText, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "left", {}, colorClasses(restProps)));
		const backLinkText = derived(() => backLink !== true && backLinkShowText ? backLink : void 0);
		function onBackClick(event) {
			restProps.onClickBack?.(event);
			restProps.onclickback?.(event);
			restProps.onBackClick?.(event);
			restProps.onbackclick?.(event);
		}
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		if (backLink) {
			$$renderer.push("<!--[0-->");
			Link($$renderer, {
				href: backLinkUrl || "#",
				back: true,
				icon: "icon-back",
				force: backLinkForce || void 0,
				class: !backLinkText() ? "icon-only" : void 0,
				text: backLinkText(),
				onclick: onBackClick
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Nav_right($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "right", {}, colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Nav_title($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, title = void 0, subtitle = void 0, children, $$slots, $$events, ...restProps } = $$props;
		const classes = derived(() => classNames(className, "title", {}, colorClasses(restProps)));
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			...restProps
		})}>`);
		if (typeof title === "function") {
			$$renderer.push("<!--[0-->");
			title?.($$renderer);
			$$renderer.push(`<!---->`);
		} else $$renderer.push(`<!--[-1-->${escape_html(title)}`);
		$$renderer.push(`<!--]--> `);
		if (typeof subtitle !== "undefined") {
			$$renderer.push(`<!--[0--><span class="subtitle">`);
			if (typeof subtitle === "function") {
				$$renderer.push("<!--[0-->");
				subtitle?.($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push(`<!--[-1-->${escape_html(subtitle)}`);
			$$renderer.push(`<!--]--></span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function Navbar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, backLink = void 0, backLinkUrl = void 0, backLinkForce = false, backLinkShowText = void 0, title = void 0, subtitle = void 0, hidden = false, outline = true, innerClass = void 0, innerClassName = void 0, large = false, largeTransparent = false, transparent = false, titleLarge = void 0, f7Slot = "fixed", children, navLeft = void 0, left = void 0, navRight = void 0, right = void 0, beforeInner = void 0, afterInner = void 0, $$slots, $$events, ...restProps } = $$props;
		let el = null;
		let theme = useTheme((t) => {
			theme = t;
		});
		let routerPositionClass = "";
		let largeCollapsed = false;
		let transparentVisible = false;
		function hide(animate) {
			app.f7.navbar.hide(el, animate);
		}
		function show(animate) {
			app.f7.navbar.show(el, animate);
		}
		function size() {
			app.f7.navbar.size(el);
		}
		const hasLeftSlots = derived(() => navLeft || left);
		const hasRightSlots = derived(() => navRight || right);
		const hasTitleSlots = derived(() => title);
		const largeTitle = derived(() => titleLarge || large && title);
		const hasTitleLargeSlots = derived(() => titleLarge);
		const addLeftTitleClass = derived(() => theme && theme.ios && app.f7 && !app.f7.params.navbar.iosCenterTitle);
		const addCenterTitleClass = derived(() => theme && theme.md && app.f7 && app.f7.params.navbar.mdCenterTitle);
		const isLarge = derived(() => large || largeTransparent);
		const isTransparent = derived(() => transparent || isLarge() && largeTransparent);
		const isTransparentVisible = derived(() => isTransparent() && transparentVisible);
		const classes = derived(() => classNames(className, "navbar", routerPositionClass, {
			"navbar-hidden": hidden,
			"navbar-large": isLarge(),
			"navbar-large-collapsed": isLarge() && largeCollapsed,
			"navbar-transparent": isTransparent(),
			"navbar-transparent-visible": isTransparentVisible(),
			"no-outline": !outline
		}, colorClasses(restProps)));
		const innerClasses = derived(() => classNames("navbar-inner", innerClass, innerClassName, {
			"navbar-inner-left-title": addLeftTitleClass(),
			"navbar-inner-centered-title": addCenterTitleClass()
		}));
		function onHide(navbarEl) {
			if (el !== navbarEl) return;
			restProps.onNavbarHide?.();
			restProps.onnavbarhide?.();
		}
		function onShow(navbarEl) {
			if (el !== navbarEl) return;
			restProps.onNavbarShow?.();
			restProps.onnavbarshow?.();
		}
		function onNavbarTransparentShow(navbarEl) {
			if (el !== navbarEl) return;
			transparentVisible = true;
			restProps.onNavbarTransparentShow?.();
			restProps.onnavbartransparentshow?.();
		}
		function onNavbarTransparentHide(navbarEl) {
			if (el !== navbarEl) return;
			transparentVisible = false;
			restProps.onNavbarTransparentHide?.();
			restProps.onnavbartransparenthide?.();
		}
		function onExpand(navbarEl) {
			if (el !== navbarEl) return;
			largeCollapsed = false;
			restProps.onNavbarExpand?.();
			restProps.onnavbarexpand?.();
		}
		function onCollapse(navbarEl) {
			if (el !== navbarEl) return;
			largeCollapsed = true;
			restProps.onNavbarCollapse?.();
			restProps.onnavbarcollapse?.();
		}
		function onNavbarPosition(navbarEl, position) {
			if (el !== navbarEl) return;
			routerPositionClass = position ? `navbar-${position}` : position;
		}
		function onBackClick() {
			restProps.onClickBack?.();
			restProps.onclickback?.();
		}
		function destroyNavbar() {
			app.f7.off("navbarShow", onShow);
			app.f7.off("navbarHide", onHide);
			app.f7.off("navbarCollapse", onCollapse);
			app.f7.off("navbarExpand", onExpand);
			app.f7.off("navbarPosition", onNavbarPosition);
			app.f7.off("navbarTransparentShow", onNavbarTransparentShow);
			app.f7.off("navbarTransparentHide", onNavbarTransparentHide);
		}
		onDestroy(() => {
			if (!app.f7) return;
			destroyNavbar();
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			"data-f7-slot": f7Slot,
			...restProps
		})}><div class="navbar-bg"></div> `);
		beforeInner?.($$renderer);
		$$renderer.push(`<!----> <div${attr_class(clsx(innerClasses()))}>`);
		if (backLink || hasLeftSlots()) {
			$$renderer.push("<!--[0-->");
			Nav_left($$renderer, {
				backLink,
				backLinkUrl,
				backLinkForce,
				backLinkShowText,
				onBackClick,
				children: ($$renderer) => {
					navLeft?.($$renderer);
					$$renderer.push(`<!----> `);
					left?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (title || subtitle || hasTitleSlots()) {
			$$renderer.push("<!--[0-->");
			Nav_title($$renderer, {
				title,
				subtitle
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (hasRightSlots()) {
			$$renderer.push("<!--[0-->");
			Nav_right($$renderer, {
				children: ($$renderer) => {
					navRight?.($$renderer);
					$$renderer.push(`<!----> `);
					right?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (largeTitle() || hasTitleLargeSlots()) {
			$$renderer.push(`<!--[0--><div class="title-large"><div class="title-large-text">`);
			if (typeof largeTitle() === "function") {
				$$renderer.push("<!--[0-->");
				largeTitle()?.($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push(`<!--[-1-->${escape_html(largeTitle())}`);
			$$renderer.push(`<!--]--></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----></div> `);
		afterInner?.($$renderer);
		$$renderer.push(`<!----></div>`);
		bind_props($$props, {
			hide,
			show,
			size
		});
	});
}
function Page_content($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, tab = false, tabActive = false, ptr = false, ptrDistance = void 0, ptrPreloader = true, ptrBottom = false, ptrMousewheel = false, infinite = false, infiniteTop = false, infiniteDistance = void 0, infinitePreloader = true, hideBarsOnScroll = false, hideNavbarOnScroll = false, hideToolbarOnScroll = false, messagesContent = false, loginScreen = false, children, $$slots, $$events, ...restProps } = $$props;
		let pageContentEl = null;
		const pageContentClasses = derived(() => classNames(className, "page-content", {
			tab,
			"tab-active": tabActive,
			"ptr-content": ptr,
			"ptr-bottom": ptrBottom,
			"infinite-scroll-content": infinite,
			"infinite-scroll-top": infiniteTop,
			"hide-bars-on-scroll": hideBarsOnScroll,
			"hide-navbar-on-scroll": hideNavbarOnScroll,
			"hide-toolbar-on-scroll": hideToolbarOnScroll,
			"messages-content": messagesContent,
			"login-screen-content": loginScreen
		}, colorClasses(restProps)));
		function onPtrPullStart(ptrEl) {
			if (ptrEl !== pageContentEl) return;
			restProps.onPtrPullStart?.();
			restProps.onptrpullstart?.();
		}
		function onPtrPullMove(ptrEl) {
			if (ptrEl !== pageContentEl) return;
			restProps.onPtrPullMove?.();
			restProps.onptrpullmove?.();
		}
		function onPtrPullEnd(ptrEl) {
			if (ptrEl !== pageContentEl) return;
			restProps.onPtrPullEnd?.();
			restProps.onptrpullend?.();
		}
		function onPtrRefresh(ptrEl, done) {
			if (ptrEl !== pageContentEl) return;
			restProps.onPtrRefresh?.(done);
			restProps.onptrrefresh?.(done);
		}
		function onPtrDone(ptrEl) {
			if (ptrEl !== pageContentEl) return;
			restProps.onPtrDone?.();
			restProps.onptrdone?.();
		}
		function onInfinite(infEl) {
			if (infEl !== pageContentEl) return;
			restProps.onInfinite?.();
			restProps.oninfinite?.();
		}
		function destroyPageContent() {
			if (ptr) {
				app.f7.off("ptrPullStart", onPtrPullStart);
				app.f7.off("ptrPullMove", onPtrPullMove);
				app.f7.off("ptrPullEnd", onPtrPullEnd);
				app.f7.off("ptrRefresh", onPtrRefresh);
				app.f7.off("ptrDone", onPtrDone);
			}
			if (infinite) app.f7.off("infinite", onInfinite);
		}
		useTab(() => pageContentEl, restProps);
		onDestroy(() => {
			if (!app.f7) return;
			destroyPageContent();
		});
		$$renderer.push(`<div${attributes({
			class: clsx(pageContentClasses()),
			"data-ptr-distance": ptrDistance,
			"data-ptr-mousewheel": ptrMousewheel || void 0,
			"data-infinite-distance": infiniteDistance || void 0,
			...restProps
		})}>`);
		if (ptr && ptrPreloader && !ptrBottom) {
			$$renderer.push(`<!--[0--><div class="ptr-preloader">`);
			Preloader($$renderer, {});
			$$renderer.push(`<!----> <div class="ptr-arrow"></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (infinite && infiniteTop && infinitePreloader) {
			$$renderer.push("<!--[0-->");
			Preloader($$renderer, { class: "infinite-scroll-preloader" });
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----> `);
		if (infinite && !infiniteTop && infinitePreloader) {
			$$renderer.push("<!--[0-->");
			Preloader($$renderer, { class: "infinite-scroll-preloader" });
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (ptr && ptrPreloader && ptrBottom) {
			$$renderer.push(`<!--[0--><div class="ptr-preloader">`);
			Preloader($$renderer, {});
			$$renderer.push(`<!----> <div class="ptr-arrow"></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
function Page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, name = void 0, withSubnavbar = void 0, subnavbar = void 0, withNavbarLarge = void 0, navbarLarge = void 0, noNavbar = void 0, noToolbar = void 0, tabs = void 0, pageContent = true, noSwipeback = void 0, ptr = void 0, ptrDistance = void 0, ptrPreloader = true, ptrBottom = void 0, ptrMousewheel = void 0, infinite = void 0, infiniteTop = void 0, infiniteDistance = void 0, infinitePreloader = true, hideBarsOnScroll = void 0, hideNavbarOnScroll = void 0, hideToolbarOnScroll = void 0, messagesContent = void 0, loginScreen = void 0, children, fixedContent, staticContent, $$slots, $$events, ...restProps } = $$props;
		let el;
		let hasSubnavbar = false;
		let hasNavbarLarge = false;
		let hasNavbarLargeCollapsed = false;
		let hasCardExpandableOpened = false;
		let routerPositionClass = "";
		let routerPageRole = null;
		let routerPageRoleDetailRoot = false;
		let routerPageMasterStack = false;
		const forceSubnavbar = derived(() => typeof subnavbar === "undefined" && typeof withSubnavbar === "undefined" ? hasSubnavbar : false);
		const forceNavbarLarge = derived(() => typeof navbarLarge === "undefined" && typeof withNavbarLarge === "undefined" ? hasNavbarLarge : false);
		const classes = derived(() => classNames(className, "page", routerPositionClass, {
			tabs,
			"page-with-subnavbar": subnavbar || withSubnavbar || forceSubnavbar(),
			"page-with-navbar-large": navbarLarge || withNavbarLarge || forceNavbarLarge(),
			"no-navbar": noNavbar,
			"no-toolbar": noToolbar,
			"no-swipeback": noSwipeback,
			"page-master": routerPageRole === "master",
			"page-master-detail": routerPageRole === "detail",
			"page-master-detail-root": routerPageRoleDetailRoot === true,
			"page-master-stacked": routerPageMasterStack === true,
			"page-with-navbar-large-collapsed": hasNavbarLargeCollapsed === true,
			"page-with-card-opened": hasCardExpandableOpened === true,
			"login-screen-page": loginScreen
		}, colorClasses(restProps)));
		function onPtrPullStart() {
			restProps.onPtrPullStart?.();
			restProps.onptrpullstart?.();
		}
		function onPtrPullMove() {
			restProps.onPtrPullMove?.();
			restProps.onptrpullmove?.();
		}
		function onPtrPullEnd() {
			restProps.onPtrPullEnd?.();
			restProps.onptrpullend?.();
		}
		function onPtrRefresh(done) {
			restProps.onPtrRefresh?.(done);
			restProps.onptrrefresh?.(done);
		}
		function onPtrDone() {
			restProps.onPtrDone?.();
			restProps.onptrdone?.();
		}
		function onInfinite() {
			restProps.onInfinite?.();
			restProps.oninfinite?.();
		}
		function onPageMounted(page) {
			if (el !== page.el) return;
			restProps.onPageMounted?.(page);
			restProps.onpagemounted?.(page);
		}
		function onPageInit(page) {
			if (el !== page.el) return;
			if (typeof withSubnavbar === "undefined" && typeof subnavbar === "undefined") {
				if (page.$navbarEl && page.$navbarEl.length && page.$navbarEl.find(".subnavbar").length || page.$el.children(".navbar").find(".subnavbar").length) hasSubnavbar = true;
			}
			if (typeof withNavbarLarge === "undefined" && typeof navbarLarge === "undefined") {
				if (page.$navbarEl && page.$navbarEl.hasClass("navbar-large") || page.$el.children(".navbar-large").length) hasNavbarLarge = true;
			}
			restProps.onPageInit?.(page);
			restProps.onpageinit?.(page);
		}
		function onPageReinit(page) {
			if (el !== page.el) return;
			restProps.onPageReinit?.(page);
			restProps.onpagereinit?.(page);
		}
		function onPageBeforeIn(page) {
			if (el !== page.el) return;
			if (!page.swipeBack) {
				if (page.from === "next") routerPositionClass = "page-next";
				if (page.from === "previous") routerPositionClass = "page-previous";
			}
			restProps.onPageBeforeIn?.(page);
			restProps.onpagebeforein?.(page);
		}
		function onPageBeforeOut(page) {
			if (el !== page.el) return;
			restProps.onPageBeforeOut?.(page);
			restProps.onpagebeforeout?.(page);
		}
		function onPageAfterOut(page) {
			if (el !== page.el) return;
			if (page.to === "next") routerPositionClass = "page-next";
			if (page.to === "previous") routerPositionClass = "page-previous";
			restProps.onPageAfterOut?.(page);
			restProps.onpageafterout?.(page);
		}
		function onPageAfterIn(page) {
			if (el !== page.el) return;
			routerPositionClass = "page-current";
			restProps.onPageAfterIn?.(page);
			restProps.onpageafterin?.(page);
		}
		function onPageBeforeRemove(page) {
			if (el !== page.el) return;
			if (page.$navbarEl && page.$navbarEl[0] && page.$navbarEl.parent()[0] && page.$navbarEl.parent()[0] !== el) page.$el.prepend(page.$navbarEl);
			restProps.onPageBeforeRemove?.(page);
			restProps.onpagebeforeremove?.(page);
		}
		function onPageBeforeUnmount(page) {
			if (el !== page.el) return;
			restProps.onPageBeforeUnmount?.(page);
			restProps.onpagebeforeunmount?.(page);
		}
		function onPagePosition(pageEl, position) {
			if (el !== pageEl) return;
			routerPositionClass = `page-${position}`;
		}
		function onPageRole(pageEl, rolesData) {
			if (el !== pageEl) return;
			routerPageRole = rolesData.role;
			routerPageRoleDetailRoot = rolesData.detailRoot;
		}
		function onPageMasterStack(pageEl) {
			if (el !== pageEl) return;
			routerPageMasterStack = true;
		}
		function onPageMasterUnstack(pageEl) {
			if (el !== pageEl) return;
			routerPageMasterStack = false;
		}
		function onPageNavbarLargeCollapsed(pageEl) {
			if (el !== pageEl) return;
			hasNavbarLargeCollapsed = true;
		}
		function onPageNavbarLargeExpanded(pageEl) {
			if (el !== pageEl) return;
			hasNavbarLargeCollapsed = false;
		}
		function onCardOpened(cardEl, pageEl) {
			if (el !== pageEl) return;
			hasCardExpandableOpened = true;
		}
		function onCardClose(cardEl, pageEl) {
			if (el !== pageEl) return;
			hasCardExpandableOpened = false;
		}
		function onPageTabShow(pageEl) {
			if (el !== pageEl) return;
			restProps.onPageTabShow?.();
			restProps.ontabshow?.();
		}
		function onPageTabHide(pageEl) {
			if (el !== pageEl) return;
			restProps.onPageTabHide?.();
			restProps.ontabhide?.();
		}
		function destroyPage() {
			app.f7.off("pageMounted", onPageMounted);
			app.f7.off("pageInit", onPageInit);
			app.f7.off("pageReinit", onPageReinit);
			app.f7.off("pageBeforeIn", onPageBeforeIn);
			app.f7.off("pageBeforeOut", onPageBeforeOut);
			app.f7.off("pageAfterOut", onPageAfterOut);
			app.f7.off("pageAfterIn", onPageAfterIn);
			app.f7.off("pageBeforeRemove", onPageBeforeRemove);
			app.f7.off("pageBeforeUnmount", onPageBeforeUnmount);
			app.f7.off("pagePosition", onPagePosition);
			app.f7.off("pageRole", onPageRole);
			app.f7.off("pageMasterStack", onPageMasterStack);
			app.f7.off("pageMasterUnstack", onPageMasterUnstack);
			app.f7.off("pageNavbarLargeCollapsed", onPageNavbarLargeCollapsed);
			app.f7.off("pageNavbarLargeExpanded", onPageNavbarLargeExpanded);
			app.f7.off("cardOpened", onCardOpened);
			app.f7.off("cardClose", onCardClose);
			app.f7.off("pageTabShow", onPageTabShow);
			app.f7.off("pageTabHide", onPageTabHide);
		}
		onDestroy(() => {
			if (!app.f7) return;
			destroyPage();
		});
		$$renderer.push(`<div${attributes({
			class: clsx(classes()),
			"data-name": name,
			...restProps
		})}>`);
		fixedContent?.($$renderer);
		$$renderer.push(`<!----> `);
		if (pageContent) {
			$$renderer.push("<!--[0-->");
			Page_content($$renderer, {
				ptr,
				ptrDistance,
				ptrPreloader,
				ptrBottom,
				ptrMousewheel,
				infinite,
				infiniteTop,
				infiniteDistance,
				infinitePreloader,
				hideBarsOnScroll,
				hideNavbarOnScroll,
				hideToolbarOnScroll,
				messagesContent,
				loginScreen,
				onPtrPullStart,
				onPtrPullMove,
				onPtrPullEnd,
				onPtrRefresh,
				onPtrDone,
				onInfinite,
				children: ($$renderer) => {
					staticContent?.($$renderer);
					$$renderer.push(`<!----> `);
					children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			});
		} else {
			$$renderer.push("<!--[-1-->");
			staticContent?.($$renderer);
			$$renderer.push(`<!----> `);
			children?.($$renderer);
			$$renderer.push(`<!---->`);
		}
		$$renderer.push(`<!--]--></div>`);
	});
}
/**
* Framework7 Svelte 9.3.0
* Build full featured iOS & Android apps using Framework7 & Svelte
* https://framework7.io/svelte/
*
* Copyright 2014-2026 Vladimir Kharlampidi
*
* Released under the MIT License
*
* Released on: October 30, 2026
*/
var framework7_svelte_default = Framework7Svelte;
var MINUTE = 6e4;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
function asTime(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value !== "string" || value.length === 0) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}
/** Relative age for a past instant. `—` is reserved for unknown values. */
function formatRelativePast(value, nowMs) {
	const time = asTime(value);
	if (time === null || !Number.isFinite(nowMs)) return "—";
	const delta = Math.max(0, nowMs - time);
	if (delta < 5e3) return "刚刚";
	if (delta < MINUTE) return `${Math.floor(delta / 1e3)} 秒前`;
	if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`;
	if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`;
	return `${Math.floor(delta / DAY)} 天前`;
}
/** Relative distance to a future instant. */
function formatRelativeFuture(value, nowMs) {
	const time = asTime(value);
	if (time === null || !Number.isFinite(nowMs)) return "—";
	const delta = Math.max(0, time - nowMs);
	if (delta < MINUTE) return `${Math.max(1, Math.ceil(delta / 1e3))} 秒后`;
	if (delta < HOUR) return `${Math.ceil(delta / MINUTE)} 分钟后`;
	if (delta < DAY) return `${Math.ceil(delta / HOUR)} 小时后`;
	return `${Math.ceil(delta / DAY)} 天后`;
}
/** Server-provided milliseconds, already bounded and classified. */
function formatAge(ageMs) {
	if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
	if (ageMs < 5e3) return "刚刚";
	if (ageMs < MINUTE) return `${Math.floor(ageMs / 1e3)} 秒前`;
	if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} 分钟前`;
	return `${Math.floor(ageMs / HOUR)} 小时前`;
}
/** Deterministic absolute text for <time title> and disclosure rows. */
function formatAbsolute(value) {
	const time = asTime(value);
	if (time === null) return "—";
	const iso = new Date(time).toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}
function Banner($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, connection, versionMismatch = null, nowMs = Date.parse(snapshot.generatedAt), onRetry = void 0 } = $$props;
		const banners = derived(() => {
			const items = [];
			if (versionMismatch) items.push({
				key: "version",
				level: "error",
				title: "页面已更新",
				message: "页面已更新，请刷新后继续。刷新前不再应用新的状态响应。",
				action: "reload"
			});
			if (connection.state === "offline") items.push({
				key: "offline",
				level: "info",
				title: "离线",
				message: "离线，显示上次快照。",
				action: null
			});
			else if (connection.state === "timeout") items.push({
				key: "timeout",
				level: "warning",
				title: "刷新超时",
				message: "刷新超时，正在重试。",
				action: onRetry ? "retry" : null
			});
			else if (connection.state === "stale") items.push({
				key: "stale",
				level: "warning",
				title: "刷新暂时失败",
				message: "刷新暂时失败，页面保留上次成功的状态；将自动重试。",
				action: onRetry ? "retry" : null
			});
			for (const notice of snapshot.notices ?? []) {
				if (versionMismatch && notice.code === "version_mismatch") continue;
				if ((connection.state === "stale" || connection.state === "timeout") && notice.code === "snapshot_stale") continue;
				items.push({
					key: `notice:${notice.code}`,
					level: notice.level === "error" ? "error" : notice.level === "warning" ? "warning" : "info",
					title: notice.title,
					message: notice.message,
					action: notice.action
				});
			}
			return items;
		});
		function reload() {
			window.location.reload();
		}
		if (banners().length > 0) {
			$$renderer.push(`<!--[0--><div class="status-banners"><!--[-->`);
			const each_array = ensure_array_like(banners());
			for (let index = 0, $$length = each_array.length; index < $$length; index++) {
				let banner = each_array[index];
				$$renderer.push(`<div${attr_class(`status-banner level-${stringify(banner.level)}`)}${attr("role", banner.level === "info" ? "status" : "alert")}${attr("aria-live", banner.level === "info" ? "polite" : "assertive")}><div class="status-banner-copy"><strong>${escape_html(banner.title)}</strong> <span>${escape_html(banner.message)}</span> `);
				if (connection.lastGoodAt && banner.key !== "version") $$renderer.push(`<!--[0--><span class="status-banner-meta">上次成功：<time${attr("datetime", connection.lastGoodAt)}>${escape_html(formatRelativePast(connection.lastGoodAt, nowMs))}</time></span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div> `);
				if (banner.action === "retry" && onRetry) {
					$$renderer.push("<!--[0-->");
					Button($$renderer, {
						type: "button",
						class: "button-small",
						onClick: onRetry,
						children: ($$renderer) => {
							$$renderer.push(`<!---->重试`);
						},
						$$slots: { default: true }
					});
				} else if (banner.action === "reload") {
					$$renderer.push("<!--[1-->");
					Button($$renderer, {
						type: "button",
						class: "button-small",
						onClick: reload,
						children: ($$renderer) => {
							$$renderer.push(`<!---->刷新页面`);
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
function DiagnosticsTable($$renderer, $$props) {
	let { rows } = $$props;
	$$renderer.push(`<div class="table-wrap" tabindex="0" role="region" aria-label="模型诊断表，可横向滚动"><table class="status-table status-diagnostics-table"><caption class="sr-only">近 30 分钟各模型的完整样本、删失样本与耗时诊断</caption><thead><tr><th scope="col">模型</th><th scope="col" class="is-numeric">完整样本</th><th scope="col" class="is-numeric">删失样本</th><th scope="col" class="is-numeric">升级前混合</th><th scope="col" class="is-numeric">完整耗时均值</th><th scope="col" class="is-numeric">TTFT 样本</th><th scope="col" class="is-numeric">速度样本</th><th scope="col" class="is-numeric">tokens/s</th></tr></thead><tbody><!--[-->`);
	const each_array = ensure_array_like(rows);
	for (let index = 0, $$length = each_array.length; index < $$length; index++) {
		let row = each_array[index];
		$$renderer.push(`<tr><th scope="row" class="status-mono">${escape_html(row.model)}</th><td class="is-numeric">${escape_html(row.completeSamples)}</td><td class="is-numeric">${escape_html(row.imputedSamples)}</td><td class="is-numeric">${escape_html(row.legacyMixedSamples)}</td><td class="is-numeric"${attr("title", row.exact)}>${escape_html(row.meanTotalText)}`);
		if (row.meanTotalMs === null) $$renderer.push(`<!--[0--><span class="sr-only">无数据</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></td><td class="is-numeric">${escape_html(row.ttftSamples)}</td><td class="is-numeric">${escape_html(row.speedSamples)}</td><td class="is-numeric">${escape_html(row.tokensPerSecond === null ? "—" : row.tokensPerSecond.toFixed(1))} `);
		if (row.tokensPerSecond === null) $$renderer.push(`<!--[0--><span class="sr-only">无数据</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></td></tr>`);
	}
	$$renderer.push(`<!--]--></tbody></table></div>`);
}
function EmptyState($$renderer, $$props) {
	let { title, detail = void 0 } = $$props;
	$$renderer.push(`<div class="status-empty" role="status"><p class="status-empty-title">${escape_html(title)}</p> `);
	if (detail) $$renderer.push(`<!--[0--><p class="status-empty-detail">${escape_html(detail)}</p>`);
	else $$renderer.push("<!--[-1-->");
	$$renderer.push(`<!--]--></div>`);
}
function DiagnosticsSection($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot } = $$props;
		const diagnostics = derived(() => snapshot.diagnostics);
		$$renderer.push(`<section class="status-diagnostics" aria-labelledby="diagnostics-heading"><div class="status-section-head"><h2 id="diagnostics-heading">诊断</h2> <span class="status-muted">近 ${escape_html(diagnostics().windowMinutes)} 分钟 · 完整与删失样本分开</span></div> `);
		if (!diagnostics().available) {
			$$renderer.push("<!--[0-->");
			EmptyState($$renderer, {
				title: "诊断数据不可用",
				detail: diagnostics().reason ?? "未知原因"
			});
		} else if (diagnostics().rows.length === 0) {
			$$renderer.push("<!--[1-->");
			EmptyState($$renderer, {
				title: "暂无诊断样本",
				detail: "完整或删失样本写入后显示。"
			});
		} else {
			$$renderer.push("<!--[-1-->");
			DiagnosticsTable($$renderer, { rows: diagnostics().rows });
		}
		$$renderer.push(`<!--]--></section>`);
	});
}
function PrimaryMetric($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { metric, compact = false, children } = $$props;
		$$renderer.push(`<div${attr_class("status-metric", void 0, {
			"is-compact": compact,
			"is-unavailable": !metric.available
		})}${attr("data-metric", metric.id)}><div class="status-metric-label">${escape_html(metric.label)}</div> <div${attr_class(`status-metric-value tone-${stringify(metric.tone)}`)}${attr("title", metric.exact)}>${escape_html(metric.value)}`);
		if (!metric.available) $$renderer.push(`<!--[0--><span class="sr-only">无数据</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div> `);
		if (metric.detail) $$renderer.push(`<!--[0--><p class="status-metric-detail">${escape_html(metric.detail)}</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (metric.reason) $$renderer.push(`<!--[0--><p class="status-metric-reason">${escape_html(metric.reason)}</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
function TokenTotalsCard($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot } = $$props;
		const metrics = derived(() => snapshot.metrics);
		const totals = derived(() => snapshot.tokenTotals);
		const unpriced = derived(() => (totals().officialValue?.models ?? []).filter((model) => !model.priced));
		const tokenMetrics = derived(() => [
			metrics().M08,
			metrics().M09,
			metrics().M10,
			metrics().M11,
			metrics().M12
		]);
		$$renderer.push(`<div class="status-token-card"><div class="status-token-head"><h2 class="status-card-title">累计 Token</h2> <span class="status-scope">${escape_html(totals().scope?.label ?? "含直连/非流式")}</span></div> `);
		if (!totals().available) $$renderer.push(`<!--[0--><p class="status-warning" role="status">共享 Token 统计当前不可用，未知值显示为 —。</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <dl class="status-token-list"><!--[-->`);
		const each_array = ensure_array_like(tokenMetrics());
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let metric = each_array[$$index];
			$$renderer.push(`<div${attr_class("status-token-row", void 0, { "is-unavailable": !metric.available })}${attr("data-metric", metric.id)}><dt>${escape_html(metric.label)}</dt> <dd${attr("title", metric.exact)}>${escape_html(metric.value)}`);
			if (!metric.available) $$renderer.push(`<!--[0--><span class="sr-only">无数据</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></dd> `);
			if (metric.detail) $$renderer.push(`<!--[0--><dd class="status-token-detail">${escape_html(metric.detail)}</dd>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></dl> <div class="status-epoch"><span>统计自</span> <time${attr("datetime", totals().epoch?.since ?? "")}>${escape_html(formatAbsolute(totals().epoch?.since))}</time> <span class="status-mono status-epoch-id"${attr("title", totals().epoch?.id ?? "")}>${escape_html(totals().epoch?.id ?? "—")}</span></div> `);
		if (totals().officialValue) {
			$$renderer.push(`<!--[0--><details class="status-disclosure"><summary>官方价格等效价值详情</summary> <p>${escape_html(totals().officialValue.note)}</p> <p>${escape_html(totals().officialValue.pricedModels)}/${escape_html(totals().officialValue.totalModels)} 模型已定价 ·
        未定价 ${escape_html(totals().officialValue.unpricedModels)} · 基准日 ${escape_html(totals().officialValue.ratesAsOf)}</p> <ul><!--[-->`);
			const each_array_1 = ensure_array_like(totals().officialValue.models);
			for (let index = 0, $$length = each_array_1.length; index < $$length; index++) {
				let model = each_array_1[index];
				$$renderer.push(`<li><span class="status-mono">${escape_html(model.model)}</span> <span>${escape_html(model.priced ? `USD $${model.valueUsd}` : "未定价，未估算")}</span> <span class="status-muted">${escape_html(model.basis)}</span></li>`);
			}
			$$renderer.push(`<!--]--></ul> `);
			if (unpriced().length > 0) $$renderer.push(`<!--[0--><p class="status-muted">未定价模型不会被猜测价格。</p>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></details>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
function StatusBadge($$renderer, $$props) {
	let { label, tone = "muted", title = void 0 } = $$props;
	$$renderer.push(`<span${attr_class(`status-badge tone-${stringify(tone)}`)}${attr("title", title)}><span class="status-badge-dot" aria-hidden="true"></span> <span>${escape_html(label)}</span></span>`);
}
function WorkersDisclosure($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, openItems = /* @__PURE__ */ new Set(), onToggleItem = () => {} } = $$props;
		const opened = derived(() => openItems.has("workers"));
		Accordion($$renderer, {
			class: "status-accordion",
			children: ($$renderer) => {
				Accordion_item($$renderer, {
					opened: opened(),
					onAccordionOpen: () => onToggleItem("workers", true),
					onAccordionClose: () => onToggleItem("workers", false),
					children: ($$renderer) => {
						Accordion_toggle($$renderer, {
							children: ($$renderer) => {
								$$renderer.push(`<button type="button" class="accordion-button"${attr("aria-expanded", opened())} aria-controls="status-workers-content"><span>按 worker 在途（M04）</span> `);
								StatusBadge($$renderer, {
									label: `${snapshot.workers.length} 个 worker`,
									tone: "muted"
								});
								$$renderer.push(`<!----></button>`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----> `);
						Accordion_content($$renderer, {
							children: ($$renderer) => {
								$$renderer.push(`<div id="status-workers-content">`);
								if (snapshot.workers.length === 0) {
									$$renderer.push("<!--[0-->");
									EmptyState($$renderer, {
										title: "尚无 worker 心跳",
										detail: "心跳写共享存储后显示按 worker 的在途请求。"
									});
								} else {
									$$renderer.push(`<!--[-1--><div class="table-wrap" tabindex="0" role="region" aria-label="按 worker 在途请求表，可横向滚动"><table class="status-table"><caption class="sr-only">按 worker 的在途上游请求</caption><thead><tr><th scope="col">Worker</th><th scope="col" class="is-numeric">在途</th><th scope="col">心跳</th><th scope="col">目录</th><th scope="col">版本</th></tr></thead><tbody><!--[-->`);
									const each_array = ensure_array_like(snapshot.workers);
									for (let index = 0, $$length = each_array.length; index < $$length; index++) {
										let worker = each_array[index];
										$$renderer.push(`<tr${attr_class("", void 0, { "is-stale": worker.stale })}><th scope="row" class="status-mono">${escape_html(worker.worker)}</th><td class="is-numeric"${attr("data-metric", worker.metric.id)}${attr("title", worker.metric.exact)}><span>${escape_html(worker.metric.value)}</span> `);
										if (worker.metric.detail) $$renderer.push(`<!--[0--><span class="status-inline-detail status-muted">${escape_html(worker.metric.detail)}</span>`);
										else $$renderer.push("<!--[-1-->");
										$$renderer.push(`<!--]--></td><td><time${attr("datetime", worker.heartbeatAt)}${attr("title", formatAbsolute(worker.heartbeatAt))}>${escape_html(formatAge(worker.ageMs))}</time> `);
										if (worker.stale) {
											$$renderer.push("<!--[0-->");
											StatusBadge($$renderer, {
												label: "已过期",
												tone: "warning",
												title: `${worker.ageMs} ms`
											});
										} else $$renderer.push("<!--[-1-->");
										$$renderer.push(`<!--]--></td><td>${escape_html(worker.catalogReady ? "就绪" : "目录加载中")}</td><td><span class="status-mono">${escape_html(worker.buildVersion)}</span> `);
										if (worker.viewSchema !== 3) {
											$$renderer.push("<!--[0-->");
											StatusBadge($$renderer, {
												label: "结构不匹配",
												tone: "warning"
											});
										} else $$renderer.push("<!--[-1-->");
										$$renderer.push(`<!--]--></td></tr>`);
									}
									$$renderer.push(`<!--]--></tbody></table></div>`);
								}
								$$renderer.push(`<!--]--></div>`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!---->`);
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
	});
}
function Overview($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, openItems = /* @__PURE__ */ new Set(), onToggleItem = () => {} } = $$props;
		$$renderer.push(`<section class="status-overview-section" aria-labelledby="overview-heading"><h2 id="overview-heading" class="sr-only">核心指标</h2> <div class="status-overview">`);
		Card($$renderer, {
			class: "status-primary-card",
			children: ($$renderer) => {
				Card_content($$renderer, {
					children: ($$renderer) => {
						PrimaryMetric($$renderer, { metric: snapshot.metrics.M01 });
						$$renderer.push(`<!----> `);
						PrimaryMetric($$renderer, { metric: snapshot.metrics.M02 });
						$$renderer.push(`<!---->`);
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> `);
		Card($$renderer, {
			class: "status-primary-card",
			children: ($$renderer) => {
				Card_content($$renderer, {
					children: ($$renderer) => {
						PrimaryMetric($$renderer, {
							metric: snapshot.metrics.M03,
							children: ($$renderer) => {
								WorkersDisclosure($$renderer, {
									snapshot,
									openItems,
									onToggleItem
								});
							},
							$$slots: { default: true }
						});
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> `);
		Card($$renderer, {
			class: "status-primary-card",
			children: ($$renderer) => {
				Card_content($$renderer, {
					children: ($$renderer) => {
						PrimaryMetric($$renderer, { metric: snapshot.metrics.M05 });
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> `);
		Card($$renderer, {
			class: "status-primary-card",
			children: ($$renderer) => {
				Card_content($$renderer, {
					children: ($$renderer) => {
						TokenTotalsCard($$renderer, { snapshot });
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></div></section>`);
	});
}
var RESET_CONTENT = `
  <div class="status-reset">
    <p id="status-reset-consequence">重置只清空累计 Token 统计与上报次数；评分、账号健康、路由前缀亲和、并发实证都不受影响。</p>
    <label for="status-reset-token">Gateway 管理 Token</label>
    <input id="status-reset-token" type="password" autocomplete="off"
           spellcheck="false" aria-describedby="status-reset-help">
    <p id="status-reset-help">Token 只用于本次请求，不保存、不写日志。</p>
    <p class="status-reset-error" role="alert" hidden></p>
  </div>`;
function isLoopbackHost() {
	if (typeof location === "undefined") return false;
	const host = location.hostname;
	return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
function secureEnough() {
	if (typeof location === "undefined") return false;
	return location.protocol === "https:" || isLoopbackHost();
}
function makeResetId() {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const bytes = /* @__PURE__ */ new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function showResetToast(f7, text) {
	const toast = f7.toast.create({
		text,
		closeTimeout: 4e3,
		cssClass: "status-toast"
	});
	toast.open();
	toast.el?.setAttribute("role", "status");
	toast.el?.setAttribute("aria-live", "polite");
}
function statusMessage(status) {
	if (status === 401) return "管理 Token 无效，未执行重置。";
	if (status === 403) return "重置仅允许通过 HTTPS 或本机回环地址。";
	if (status === 409) return "另一个重置刚刚完成，正在刷新当前统计。";
	if (status === 405) return "服务器不接受该重置请求。";
	if (status === 503) return "计数服务暂不可用，数值未变，请稍后重试。";
	return `重置失败（HTTP ${status}），数值未变。`;
}
/**
* Framework7 Dialog reset flow. The token lives only in this function's local
* scope; it is cleared before the request settles and never logged.
*/
function openResetDialog({ f7, resetPath, onSuccess, onConflict }) {
	let pending = false;
	let closed = false;
	const previousFocus = typeof document !== "undefined" ? document.activeElement : null;
	const dialog = f7.dialog.create({
		title: "重置累计 Token 统计",
		content: RESET_CONTENT,
		closeByBackdrop: false,
		destroyOnClose: true,
		buttons: [{
			text: "取消",
			keyCodes: [27]
		}, {
			text: "重置",
			strong: true,
			close: false,
			onClick: (instance) => {
				submit(instance);
			}
		}],
		on: { closed() {
			closed = true;
			dialog.el?.removeEventListener("keydown", trapFocus);
			document.querySelector(".page")?.removeAttribute("inert");
			document.querySelector(".page")?.removeAttribute("aria-hidden");
			document.querySelector(".status-skip")?.removeAttribute("inert");
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
		} }
	});
	function trapFocus(event) {
		if (event.key !== "Tab" || !dialog.el) return;
		const focusable = [...dialog.el.querySelectorAll("button, input, [href], [tabindex]")].filter((node) => !node.disabled && node.getAttribute("tabindex") !== "-1" && node.offsetParent !== null);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
	function setError(message) {
		const node = dialog.el?.querySelector(".status-reset-error");
		if (!node) return;
		node.textContent = message;
		node.hidden = !message;
	}
	function setBusy(busy) {
		const buttons = dialog.el?.querySelectorAll(".dialog-button") ?? [];
		for (const button of buttons) button.disabled = busy;
		dialog.el?.setAttribute("aria-busy", busy ? "true" : "false");
	}
	async function submit(instance) {
		if (pending || closed) return;
		const input = instance.el?.querySelector("#status-reset-token");
		const token = typeof input?.value === "string" ? input.value : "";
		if (input) input.value = "";
		setError("");
		if (token.length === 0) {
			setError("请输入 Gateway 管理 Token。");
			input?.focus();
			return;
		}
		if (!secureEnough()) {
			setError("重置仅允许通过 HTTPS 或本机回环地址。");
			return;
		}
		pending = true;
		setBusy(true);
		try {
			const response = await fetch(resetPath, {
				method: "POST",
				cache: "no-store",
				credentials: "same-origin",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
					"x-lazy-reset": "token-totals"
				},
				body: JSON.stringify({ resetId: makeResetId() })
			});
			if (!response.ok) {
				setError(statusMessage(response.status));
				if (response.status === 409) onConflict?.();
				return;
			}
			const data = await response.json();
			closed = true;
			instance.close();
			showResetToast(f7, "累计 Token 统计已重置。");
			onSuccess?.(data);
		} catch {
			setError("网络错误，未确认重置结果；数值可能未变，请刷新后重试。");
		} finally {
			pending = false;
			if (!closed) setBusy(false);
		}
	}
	dialog.open();
	if (dialog.el) {
		dialog.el.setAttribute("role", "dialog");
		dialog.el.setAttribute("aria-modal", "true");
		dialog.el.setAttribute("aria-describedby", "status-reset-consequence status-reset-help");
		const title = dialog.el.querySelector(".dialog-title");
		if (title) {
			title.id = "status-reset-dialog-title";
			dialog.el.setAttribute("aria-labelledby", title.id);
		}
		dialog.el.addEventListener("keydown", trapFocus);
		document.querySelector(".page")?.setAttribute("inert", "");
		document.querySelector(".page")?.setAttribute("aria-hidden", "true");
		document.querySelector(".status-skip")?.setAttribute("inert", "");
		requestAnimationFrame(() => {
			dialog.el?.querySelector("#status-reset-token")?.focus();
		});
	}
	return dialog;
}
function StatusButton($$renderer, $$props) {
	let { disabled = false, fill = false, className = "", children, onclick = void 0, ariaLabel = void 0, describedBy = void 0 } = $$props;
	if (disabled) {
		$$renderer.push(`<!--[0--><button type="button"${attr_class(`button disabled ${fill ? "button-fill" : ""} ${stringify(className)}`)} disabled="" aria-disabled="true" tabindex="-1"${attr("aria-label", ariaLabel)}${attr("aria-describedby", describedBy)}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></button>`);
	} else {
		$$renderer.push("<!--[-1-->");
		Button($$renderer, {
			type: "button",
			class: className,
			fill,
			onClick: onclick,
			"aria-label": ariaLabel,
			"aria-describedby": describedBy,
			children: ($$renderer) => {
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			},
			$$slots: { default: true }
		});
	}
	$$renderer.push(`<!--]-->`);
}
function ResetAction($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { jsReady = false, onResetSuccess = void 0 } = $$props;
		let statusText = "";
		function resetPath() {
			return document.querySelector("meta[name=\"lazy-reset-path\"]")?.getAttribute("content") ?? "";
		}
		function onResetClick() {
			const f7 = app.f7;
			if (!f7) {
				statusText = "页面尚未就绪，请稍后重试。";
				return;
			}
			const path = resetPath();
			if (!path.startsWith("/")) {
				statusText = "重置路径不可用，请刷新页面。";
				return;
			}
			openResetDialog({
				f7,
				resetPath: path,
				onSuccess() {
					statusText = "累计 Token 统计已重置，正在刷新。";
					onResetSuccess?.();
				},
				onConflict() {
					statusText = "另一个重置刚刚完成，正在刷新当前统计。";
					onResetSuccess?.();
				}
			});
		}
		$$renderer.push(`<section class="status-reset-section" aria-labelledby="reset-heading"><h2 id="reset-heading">重置累计 Token 统计</h2> <p id="reset-explanation">重置会创建新的 Token 统计纪元，只清空累计 Token 与上报次数；评分、账号健康、路由前缀亲和、并发实证均不受影响。
    该操作需要 Gateway 管理 Token，并通过 HTTPS 或本机回环地址执行。</p> `);
		StatusButton($$renderer, {
			className: "status-reset-button",
			fill: true,
			disabled: !jsReady,
			onclick: onResetClick,
			describedBy: "reset-explanation",
			children: ($$renderer) => {
				$$renderer.push(`<!---->重置 Token 统计…`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> <p class="status-muted">${escape_html(jsReady ? "重置需要 Gateway 管理 Token，并通过 HTTPS 或本机回环地址执行。" : "重置需要 JavaScript；服务端内容无需 JavaScript 即可阅读。")}</p> <p class="sr-only" role="status" aria-live="polite">${escape_html(statusText)}</p></section>`);
	});
}
function UnitList($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { channel } = $$props;
		const healthTone = derived(() => (unit) => unit.health === "alive" ? "positive" : unit.health === "cooling" ? "warning" : unit.health === "busy" ? "normal" : "muted");
		if (channel.units.length === 0) $$renderer.push(`<!--[0--><p class="status-inline-empty" role="status">这个通道当前没有账号候选。</p>`);
		else {
			$$renderer.push("<!--[-1-->");
			List($$renderer, {
				class: "unit-list",
				ul: true,
				children: ($$renderer) => {
					$$renderer.push(`<!--[-->`);
					const each_array = ensure_array_like(channel.units);
					for (let index = 0, $$length = each_array.length; index < $$length; index++) {
						let unit = each_array[index];
						List_item($$renderer, {
							class: "unit-item",
							children: ($$renderer) => {
								$$renderer.push(`<div class="unit-head"><span class="unit-name status-mono">${escape_html(unit.displayName)}</span> `);
								StatusBadge($$renderer, {
									label: unit.healthLabel,
									tone: healthTone()(unit)
								});
								$$renderer.push(`<!----> `);
								if (unit.stale) {
									$$renderer.push("<!--[0-->");
									StatusBadge($$renderer, {
										label: "容量/心跳已过期",
										tone: "warning"
									});
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--></div> <div class="status-metric-grid unit-metrics">`);
								PrimaryMetric($$renderer, {
									metric: unit.metrics.M20,
									compact: true
								});
								$$renderer.push(`<!----> `);
								PrimaryMetric($$renderer, {
									metric: unit.metrics.M21,
									compact: true
								});
								$$renderer.push(`<!----> `);
								PrimaryMetric($$renderer, {
									metric: unit.metrics.M22,
									compact: true
								});
								$$renderer.push(`<!----> `);
								PrimaryMetric($$renderer, {
									metric: unit.metrics.M23,
									compact: true
								});
								$$renderer.push(`<!----></div> `);
								if (unit.capacity) {
									$$renderer.push(`<!--[0--><p class="unit-capacity status-muted">租约 ${escape_html(unit.capacity.max === 0 ? "不限" : `${unit.capacity.held}/${unit.capacity.max}`)}
            · ${escape_html(unit.capacity.scope === "unit" ? "账号" : "账号+模型")} `);
									if (unit.capacity.stale) $$renderer.push(`<!--[0-->· 已过期`);
									else $$renderer.push("<!--[-1-->");
									$$renderer.push(`<!--]--></p>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]-->`);
							},
							$$slots: { default: true }
						});
					}
					$$renderer.push(`<!--]-->`);
				},
				$$slots: { default: true }
			});
		}
		$$renderer.push(`<!--]-->`);
	});
}
function ChannelRow($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { channel, openItems = /* @__PURE__ */ new Set(), onToggleItem = () => {} } = $$props;
		const accordionId = derived(() => `channel:${channel.id}`);
		const accordionDomId = derived(() => `status-acc-${channel.id.replace(/[^A-Za-z0-9_-]/g, "-")}`);
		const opened = derived(() => openItems.has(accordionId()));
		const perfIds = [
			"M13",
			"M14",
			"M15",
			"M16",
			"M17",
			"M18",
			"M19"
		];
		$$renderer.push(`<article class="channel-row"${attr("aria-label", channel.model)}><header class="channel-head"><h4 class="channel-model status-mono">${escape_html(channel.model)}</h4> <div class="channel-badges">`);
		StatusBadge($$renderer, {
			label: `effort ${channel.effort}`,
			tone: "muted"
		});
		$$renderer.push(`<!----> `);
		StatusBadge($$renderer, {
			label: `可用 ${channel.available} / ${channel.totalUnits}`,
			tone: channel.available > 0 ? "positive" : "muted"
		});
		$$renderer.push(`<!----></div></header> `);
		UnitList($$renderer, { channel });
		$$renderer.push(`<!----> `);
		Accordion($$renderer, {
			class: "status-accordion channel-diagnostics",
			children: ($$renderer) => {
				Accordion_item($$renderer, {
					opened: opened(),
					onAccordionOpen: () => onToggleItem(accordionId(), true),
					onAccordionClose: () => onToggleItem(accordionId(), false),
					children: ($$renderer) => {
						Accordion_toggle($$renderer, {
							children: ($$renderer) => {
								$$renderer.push(`<button type="button" class="accordion-button"${attr("aria-expanded", opened())}${attr("aria-controls", accordionDomId())}><span>诊断与并发</span> <span class="sr-only">：${escape_html(channel.model)}</span></button>`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----> `);
						Accordion_content($$renderer, {
							children: ($$renderer) => {
								$$renderer.push(`<div${attr("id", accordionDomId())}><div class="status-metric-grid"><!--[-->`);
								const each_array = ensure_array_like(perfIds);
								for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
									let id = each_array[$$index];
									PrimaryMetric($$renderer, {
										metric: channel.perf[id],
										compact: true
									});
								}
								$$renderer.push(`<!--]--></div></div>`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!---->`);
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></article>`);
	});
}
function StrategyTree($$renderer, $$props) {
	let { graph } = $$props;
	function marker(node, index) {
		return node.type === "model" ? "◆" : `${index + 1}`;
	}
	function node($$renderer, item, index) {
		$$renderer.push(`<li${attr_class("tree-node", void 0, {
			"tree-leaf": item.type === "model",
			"tree-op": item.type !== "model"
		})}><span class="tree-marker" aria-hidden="true">${escape_html(marker(item, index))}</span> <span class="tree-label">${escape_html(item.label ?? item.model)}</span> `);
		if (item.children?.length) {
			$$renderer.push(`<!--[0--><ul class="tree-children"><!--[-->`);
			const each_array = ensure_array_like(item.children);
			for (let childIndex = 0, $$length = each_array.length; childIndex < $$length; childIndex++) {
				let child = each_array[childIndex];
				node($$renderer, child, childIndex);
			}
			$$renderer.push(`<!--]--></ul>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></li>`);
	}
	$$renderer.push(`<ul class="status-tree" aria-label="路由组合树">`);
	node($$renderer, graph, 0);
	$$renderer.push(`<!----></ul>`);
}
function RouteCard($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { route, openItems = /* @__PURE__ */ new Set(), onToggleItem = () => {} } = $$props;
		const stateMeta = derived(() => route.state === "alive" ? {
			label: "可用",
			tone: "positive"
		} : route.state === "cooling" ? {
			label: "冷却",
			tone: "warning"
		} : route.state === "loading" ? {
			label: "目录加载中",
			tone: "muted"
		} : {
			label: "空",
			tone: "muted"
		});
		Card($$renderer, {
			class: "route-card",
			"aria-label": `${route.title} ${route.id}`,
			children: ($$renderer) => {
				Card_content($$renderer, {
					children: ($$renderer) => {
						$$renderer.push(`<header class="route-head"><div class="route-title-row"><h3 class="route-title">${escape_html(route.title)}</h3> `);
						StatusBadge($$renderer, {
							label: stateMeta().label,
							tone: stateMeta().tone
						});
						$$renderer.push(`<!----></div> <p class="route-id status-mono">${escape_html(route.id)}</p> <p class="route-counts">可用 ${escape_html(route.available)} / ${escape_html(route.totalUnits)} 个账号 · ${escape_html(route.channels.length)} 个通道</p></header> <p class="route-strategy">${escape_html(route.strategy)}</p> `);
						if (route.graph) {
							$$renderer.push("<!--[0-->");
							StrategyTree($$renderer, { graph: route.graph });
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="route-channels">`);
						if (route.channels.length === 0) {
							$$renderer.push("<!--[0-->");
							if (route.state === "loading") {
								$$renderer.push("<!--[0-->");
								EmptyState($$renderer, {
									title: "目录加载中",
									detail: "目录就绪后将显示候选通道。"
								});
							} else {
								$$renderer.push("<!--[-1-->");
								EmptyState($$renderer, {
									title: "这个组合当前没有候选通道",
									detail: "检查模型目录或账号健康。"
								});
							}
							$$renderer.push(`<!--]-->`);
						} else {
							$$renderer.push(`<!--[-1--><!--[-->`);
							const each_array = ensure_array_like(route.channels);
							for (let index = 0, $$length = each_array.length; index < $$length; index++) {
								let channel = each_array[index];
								ChannelRow($$renderer, {
									channel,
									openItems,
									onToggleItem
								});
							}
							$$renderer.push(`<!--]-->`);
						}
						$$renderer.push(`<!--]--></div>`);
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
	});
}
function RoutesSection($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, openItems = /* @__PURE__ */ new Set(), onToggleItem = () => {} } = $$props;
		$$renderer.push(`<section class="status-routes" aria-labelledby="routes-heading"><h2 id="routes-heading" tabindex="-1">路由</h2> `);
		if (snapshot.routes.length === 0) {
			$$renderer.push("<!--[0-->");
			EmptyState($$renderer, {
				title: snapshot.catalog.ready ? "没有可选路由" : "目录加载中",
				detail: snapshot.catalog.ready ? "检查模型目录或账号健康。" : "目录就绪后将显示路由与候选通道。"
			});
		} else {
			$$renderer.push(`<!--[-1--><!--[-->`);
			const each_array = ensure_array_like(snapshot.routes);
			for (let index = 0, $$length = each_array.length; index < $$length; index++) {
				let route = each_array[index];
				RouteCard($$renderer, {
					route,
					openItems,
					onToggleItem
				});
			}
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></section>`);
	});
}
function CapacityTable($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot } = $$props;
		const capacity = derived(() => snapshot.capacity);
		$$renderer.push(`<section class="status-table-section" aria-labelledby="capacity-heading"><h3 id="capacity-heading">账号并发（M21）</h3> `);
		if (!capacity().available) {
			$$renderer.push("<!--[0-->");
			EmptyState($$renderer, {
				title: "共享并发状态不可用",
				detail: capacity().reason ?? "未知原因"
			});
		} else if (capacity().rows.length === 0) {
			$$renderer.push("<!--[1-->");
			EmptyState($$renderer, {
				title: "暂无并发租约",
				detail: "没有账号正在持有并发槽位。"
			});
		} else {
			$$renderer.push(`<!--[-1--><p class="status-table-summary">活跃 ${escape_html(capacity().liveCount)} · 过期 ${escape_html(capacity().staleCount)} · 过期租约不计入活跃容量</p> <div class="table-wrap" tabindex="0" role="region" aria-label="账号并发租约表，可横向滚动"><table class="status-table"><caption class="sr-only">按账号的并发租约，过期行不计入活跃容量</caption><thead><tr><th scope="col">账号</th><th scope="col">模型</th><th scope="col" class="is-numeric">并发</th><th scope="col">作用域</th><th scope="col">Worker</th><th scope="col">更新</th></tr></thead><tbody><!--[-->`);
			const each_array = ensure_array_like(capacity().rows);
			for (let index = 0, $$length = each_array.length; index < $$length; index++) {
				let row = each_array[index];
				$$renderer.push(`<tr${attr_class("", void 0, { "is-stale": row.stale })}><th scope="row">${escape_html(row.displayName)}</th><td class="status-mono">${escape_html(row.model ?? "—")}</td><td class="is-numeric">`);
				if (row.max === 0) $$renderer.push(`<!--[0-->不限`);
				else $$renderer.push(`<!--[-1-->${escape_html(row.held)}/${escape_html(row.max)}`);
				$$renderer.push(`<!--]--> `);
				if (row.stale) {
					$$renderer.push("<!--[0-->");
					StatusBadge($$renderer, {
						label: "已过期",
						tone: "warning",
						title: `${row.ageMs} ms`
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></td><td>${escape_html(row.scope === "unit" ? "账号" : "账号+模型")}</td><td class="status-mono">${escape_html(row.worker)}</td><td><time${attr("datetime", row.updatedAt)}${attr("title", formatAbsolute(row.updatedAt))}>${escape_html(formatAge(row.ageMs))}</time></td></tr>`);
			}
			$$renderer.push(`<!--]--></tbody></table></div>`);
		}
		$$renderer.push(`<!--]--></section>`);
	});
}
function HealthTable($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, nowMs } = $$props;
		const health = derived(() => snapshot.health);
		const labels = {
			alive: {
				text: "可用",
				tone: "positive"
			},
			cooling: {
				text: "冷却",
				tone: "warning"
			},
			busy: {
				text: "繁忙",
				tone: "normal"
			},
			unknown: {
				text: "待检查",
				tone: "muted"
			}
		};
		function labelFor(state) {
			return labels[state] ?? labels.unknown;
		}
		function nextProbe(row) {
			return row.nextProbeAt ?? row.probeLeaseUntil ?? row.until ?? null;
		}
		$$renderer.push(`<section class="status-table-section" aria-labelledby="health-heading"><h3 id="health-heading">账号健康（M20 / M22 / M23）</h3> `);
		if (!health().available) {
			$$renderer.push("<!--[0-->");
			EmptyState($$renderer, {
				title: "共享健康状态不可用",
				detail: health().reason ?? "未知原因"
			});
		} else if (health().rows.length === 0) {
			$$renderer.push("<!--[1-->");
			EmptyState($$renderer, {
				title: "暂无健康记录",
				detail: "账号探测写入共享健康表后显示。"
			});
		} else {
			$$renderer.push(`<!--[-1--><div class="table-wrap" tabindex="0" role="region" aria-label="账号健康表，可横向滚动"><table class="status-table"><caption class="sr-only">共享账号健康、下次探测与冷却原因</caption><thead><tr><th scope="col">账号</th><th scope="col">模型</th><th scope="col">健康</th><th scope="col">下次探测</th><th scope="col">原因</th><th scope="col">更新</th></tr></thead><tbody><!--[-->`);
			const each_array = ensure_array_like(health().rows);
			for (let index = 0, $$length = each_array.length; index < $$length; index++) {
				let row = each_array[index];
				$$renderer.push(`<tr><th scope="row">${escape_html(row.displayName)}</th><td class="status-mono">${escape_html(row.model)}</td><td>`);
				StatusBadge($$renderer, {
					label: labelFor(row.health).text,
					tone: labelFor(row.health).tone
				});
				$$renderer.push(`<!----></td><td>`);
				if (nextProbe(row)) $$renderer.push(`<!--[0--><time${attr("datetime", nextProbe(row))}${attr("title", formatAbsolute(nextProbe(row)))}>${escape_html(formatRelativeFuture(nextProbe(row), nowMs))}</time>`);
				else $$renderer.push(`<!--[-1-->—<span class="sr-only">无数据</span>`);
				$$renderer.push(`<!--]--></td><td class="status-reason">${escape_html(row.reason ?? "—")}`);
				if (!row.reason) $$renderer.push(`<!--[0--><span class="sr-only">无数据</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></td><td><time${attr("datetime", row.updatedAt)}${attr("title", formatAbsolute(row.updatedAt))}>${escape_html(formatAge(row.ageMs))}</time></td></tr>`);
			}
			$$renderer.push(`<!--]--></tbody></table></div>`);
		}
		$$renderer.push(`<!--]--></section>`);
	});
}
function SecondaryMetrics($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, nowMs } = $$props;
		const metrics = derived(() => snapshot.metrics);
		const diagnosticIds = derived(() => snapshot.overview.secondary.find((group) => group.key === "routeDiagnostics")?.metricIds ?? []);
		const firstPerf = derived(() => snapshot.routes.flatMap((route) => route.channels).find((channel) => channel.perf)?.perf ?? null);
		$$renderer.push(`<section class="status-secondary" aria-labelledby="secondary-heading"><h2 id="secondary-heading">运行概览</h2> <div class="status-secondary-grid">`);
		PrimaryMetric($$renderer, {
			metric: metrics().M06,
			compact: true
		});
		$$renderer.push(`<!----> `);
		PrimaryMetric($$renderer, {
			metric: metrics().M07,
			compact: true
		});
		$$renderer.push(`<!----> `);
		PrimaryMetric($$renderer, {
			metric: metrics().M24,
			compact: true
		});
		$$renderer.push(`<!----> `);
		PrimaryMetric($$renderer, {
			metric: metrics().M26,
			compact: true
		});
		$$renderer.push(`<!----></div> <div class="status-tables">`);
		CapacityTable($$renderer, { snapshot });
		$$renderer.push(`<!----> `);
		HealthTable($$renderer, {
			snapshot,
			nowMs
		});
		$$renderer.push(`<!----></div> <details class="status-disclosure status-diagnostic-key"><summary>路由诊断口径（M13–M19）</summary> <p>这些值在每个路由通道的「诊断与并发」中读取同一份全局后验，不在浏览器中汇总。</p> `);
		if (firstPerf()) {
			$$renderer.push(`<!--[0--><ul><!--[-->`);
			const each_array = ensure_array_like(diagnosticIds());
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let id = each_array[$$index];
				const metric = firstPerf()[id];
				if (metric) $$renderer.push(`<!--[0--><li><span>${escape_html(metric.label)}</span> <span class="status-muted">${escape_html(metric.detail || metric.window)}</span></li>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></ul>`);
		} else $$renderer.push(`<!--[-1--><p class="status-muted">暂无通道诊断样本。</p>`);
		$$renderer.push(`<!--]--></details> <p class="status-muted status-m25"${attr("data-metric", metrics().M25.id)}${attr("title", metrics().M25.exact)}>${escape_html(metrics().M25.label)}：${escape_html(metrics().M25.value)} · ${escape_html(metrics().M25.scope)} `);
		if (metrics().M25.reason) $$renderer.push(`<!--[0-->· ${escape_html(metrics().M25.reason)}`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></p></section>`);
	});
}
function SnapshotMeta($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, nowMs } = $$props;
		const metric = derived(() => snapshot.metrics.M27);
		$$renderer.push(`<footer class="status-footer" role="contentinfo"><p>上次更新 <time${attr("datetime", snapshot.generatedAt)}${attr("title", formatAbsolute(snapshot.generatedAt))}>${escape_html(formatRelativePast(snapshot.generatedAt, nowMs))}</time> <span class="status-muted">· 快照 ${escape_html(snapshot.snapshotId)}</span></p> <details class="status-disclosure"><summary>快照诊断</summary> <dl class="status-dl"><dt>快照</dt> <dd class="status-mono">${escape_html(snapshot.snapshotId)}</dd> <dt>构建</dt> <dd class="status-mono">${escape_html(snapshot.buildVersion)}</dd> <dt>回答者</dt> <dd class="status-mono">${escape_html(snapshot.answeredBy)}</dd> <dt>结构版本</dt> <dd>${escape_html(snapshot.schemaVersion)}</dd> <dt>Token 纪元</dt> <dd class="status-mono">${escape_html(snapshot.epoch.id)}</dd> <dt>纪元开始</dt> <dd><time${attr("datetime", snapshot.epoch.since ?? "")}>${escape_html(formatAbsolute(snapshot.epoch.since))}</time></dd> <dt>${escape_html(metric().label)}</dt> <dd${attr("data-metric", metric().id)}${attr("title", metric().exact)}>${escape_html(metric().value)}</dd> <dt>共享状态</dt> <dd>${escape_html(snapshot.store.mode)}${escape_html(snapshot.store.available ? "" : ` · ${snapshot.store.reason ?? "不可用"}`)}</dd></dl></details></footer>`);
	});
}
function StatusApp($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { snapshot, nowMs, connection, jsReady, versionMismatch = null, refreshing = false, onRefresh = void 0, onResetSuccess = void 0, openItems = /* @__PURE__ */ new Set(), onToggleItem = () => {} } = $$props;
		const refreshReady = derived(() => jsReady && typeof onRefresh === "function");
		const connectionText = derived(() => refreshing ? "刷新中" : connection.state === "offline" ? "离线" : connection.state === "timeout" || connection.state === "stale" ? "重试中" : connection.state === "live" ? "已连接" : "服务端快照");
		function navRight($$renderer) {
			$$renderer.push(`<span${attr_class("status-live", void 0, { "is-warning": connection.state !== "live" && connection.state !== "server" })}${attr("aria-label", `连接状态：${connectionText()}`)}><span class="status-live-dot" aria-hidden="true"></span> <span>${escape_html(connectionText())}</span></span> `);
			StatusButton($$renderer, {
				className: "status-refresh",
				disabled: !refreshReady(),
				onclick: onRefresh,
				ariaLabel: "立即刷新状态",
				children: ($$renderer) => {
					$$renderer.push(`<!---->刷新`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!---->`);
		}
		function fixed($$renderer) {
			Navbar($$renderer, {
				title: "Lazy · 路由观测",
				right: navRight,
				"data-f7-slot": "fixed",
				role: "banner",
				"aria-label": "Lazy 路由观测页眉"
			});
		}
		function overlays($$renderer) {
			Banner($$renderer, {
				snapshot,
				connection,
				versionMismatch,
				nowMs,
				onRetry: onRefresh
			});
		}
		App($$renderer, {
			theme: "md",
			name: "omp-status",
			darkMode: "auto",
			children: ($$renderer) => {
				Page($$renderer, {
					fixedContent: fixed,
					staticContent: overlays,
					children: ($$renderer) => {
						$$renderer.push(`<main id="main-content" class="status-main" tabindex="-1"><h1 class="sr-only">Lazy 路由观测</h1> `);
						Overview($$renderer, {
							snapshot,
							openItems,
							onToggleItem
						});
						$$renderer.push(`<!----> `);
						SecondaryMetrics($$renderer, {
							snapshot,
							nowMs
						});
						$$renderer.push(`<!----> `);
						RoutesSection($$renderer, {
							snapshot,
							openItems,
							onToggleItem
						});
						$$renderer.push(`<!----> `);
						DiagnosticsSection($$renderer, { snapshot });
						$$renderer.push(`<!----> `);
						ResetAction($$renderer, {
							jsReady,
							onResetSuccess
						});
						$$renderer.push(`<!----> `);
						SnapshotMeta($$renderer, {
							snapshot,
							nowMs
						});
						$$renderer.push(`<!----> <div id="status-announcer" class="sr-only" role="status" aria-live="polite"></div></main>`);
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
	});
}
framework7_esm_default.use(framework7_svelte_default);
var DEFAULT_ASSET_BASE = "/assets/lazy-status";
function escapeAttribute(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
/**
* JSON inside an inert <template> is parsed as HTML text, not as a raw-text
* element. Escaping `<` also prevents `</template>`; escaping `&` preserves
* entity-looking payloads byte-for-byte after JSON.parse.
*/
function escapeTemplateJson(value) {
	return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
function normalizeBase(basePath) {
	if (typeof basePath !== "string" || basePath.length === 0) return "";
	const trimmed = basePath.replace(/\/+$/, "");
	if (!trimmed.startsWith("/")) throw new Error(`status base path must start with "/": ${basePath}`);
	return trimmed;
}
function joinUrl(basePath, path) {
	if (typeof path !== "string" || !path.startsWith("/")) throw new Error(`status URL path must start with "/": ${path}`);
	return `${basePath}${path}`;
}
function assetUrl(basePath, assetBasePath, name) {
	const base = typeof assetBasePath === "string" && assetBasePath.length > 0 ? assetBasePath : DEFAULT_ASSET_BASE;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/.test(name)) throw new Error(`status asset name is not allowlisted: ${name}`);
	return joinUrl(basePath, `${base.replace(/\/+$/, "")}/${name}`);
}
function resolveAssets(options) {
	const manifest = options.manifest && typeof options.manifest === "object" ? options.manifest : {};
	const buildVersion = options.buildVersion ?? manifest.buildId;
	if (typeof buildVersion !== "string" || buildVersion.length === 0) throw new Error("renderStatusDocument requires buildVersion or manifest.buildId");
	const entry = options.entry ?? manifest.entry;
	if (typeof entry !== "string" || entry.length === 0) throw new Error("renderStatusDocument requires an entry asset");
	const css = Array.isArray(options.css) ? options.css : manifest.css ?? [];
	if (!Array.isArray(css) || css.some((name) => typeof name !== "string")) throw new Error("renderStatusDocument css must be an array of asset names");
	const basePath = normalizeBase(options.basePath);
	const entryUrl = options.entryUrl ?? assetUrl(basePath, options.assetBasePath, entry);
	const styleUrls = Array.isArray(options.styleUrls) && options.styleUrls.length > 0 ? options.styleUrls : css.map((name) => assetUrl(basePath, options.assetBasePath, name));
	const statusPath = options.statusPath ?? joinUrl(basePath, "/v1/lazy/status");
	const resetPath = options.resetPath ?? joinUrl(basePath, "/v1/lazy/token-totals/reset");
	if (!statusPath.startsWith("/") || !resetPath.startsWith("/")) throw new Error("status bootstrap paths must be absolute");
	return {
		buildVersion,
		entryUrl,
		styleUrls,
		statusPath,
		resetPath,
		basePath
	};
}
/**
* Build the complete status document. Every value is server-rendered; the
* only bootstrap payload is an inert JSON template. No inline script exists,
* so `script-src 'self'` needs no exception.
*/
function renderStatusDocument(snapshot, options = {}) {
	if (!snapshot || typeof snapshot !== "object") throw new TypeError("renderStatusDocument requires a snapshot");
	if (typeof snapshot.snapshotId !== "string" || typeof snapshot.generatedAt !== "string") throw new TypeError("snapshot must carry snapshotId and generatedAt");
	const assets = resolveAssets({
		...options,
		buildVersion: options.buildVersion ?? options.manifest?.buildId ?? snapshot.buildVersion
	});
	const nowMs = Date.parse(snapshot.generatedAt);
	if (!Number.isFinite(nowMs)) throw new TypeError("snapshot.generatedAt is not a valid ISO timestamp");
	const rendered = render(StatusApp, { props: {
		snapshot,
		nowMs,
		connection: {
			state: "server",
			lastGoodAt: snapshot.generatedAt,
			error: null
		},
		jsReady: false,
		versionMismatch: null
	} });
	const snapshotId = escapeAttribute(snapshot.snapshotId);
	const styles = assets.styleUrls.map((href) => `    <link rel="stylesheet" href="${escapeAttribute(href)}">`).join("\n");
	return `<!doctype html>
<html lang="zh-CN" class="md" data-js="off">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light dark">
    <meta name="robots" content="noindex, nofollow">
    <meta name="status-build" content="${escapeAttribute(assets.buildVersion)}">
    <meta name="status-snapshot" content="${snapshotId}">
    <meta name="lazy-status-path" content="${escapeAttribute(assets.statusPath)}">
    <meta name="lazy-reset-path" content="${escapeAttribute(assets.resetPath)}">
    <title>Lazy 路由观测</title>
${styles}
  </head>
  <body class="status-body">
    <a class="status-skip" href="#main-content">跳到主要内容</a>
    <noscript>
      <p class="status-noscript">页面内容已完整呈现；实时刷新与累计统计重置需要 JavaScript。</p>
    </noscript>
    <div id="status-root" data-snapshot-id="${snapshotId}">${rendered.body}</div>
    <template id="status-snapshot">${escapeTemplateJson(snapshot)}</template>
    <script type="module" src="${escapeAttribute(assets.entryUrl)}"><\/script>
  </body>
</html>
`;
}
export { escapeTemplateJson, renderStatusDocument };
