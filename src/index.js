import postcss from "postcss";
import postcssJs from "postcss-js";
import fs from "fs";
import serialize from "babel-literal-to-ast";
import merge from "lodash/merge";
import isArray from "lodash/isArray";
import path from "path";

let twConfig = {};
if (fs.existsSync("./tailwind.js")) {
  twConfig = require(process.cwd() + "/tailwind.js");
} else {
  twConfig = require("tailwindcss/defaultConfig")();
}

let twObj = {};
if (fs.existsSync("./tailwind.custom.css")) {
  twObj = fs.readFileSync("./tailwind.custom.css", "utf8");
} else {
  twObj = fs.readFileSync("./node_modules/tailwindcss/dist/tailwind.min.css", "utf8");
}

twObj = postcss.parse(twObj);
twObj = postcssJs.objectify(twObj);
twObj = formatTailwindObj(twObj);

export default function(babel) {
  const { types: t } = babel;

  return {
    name: "tailwind-to-css-in-js", // not required
    visitor: {
      CallExpression(path) {
        const node = path.node;

        if (
          node.callee.name === "tw" &&
          (t.isStringLiteral(node.arguments[0]) || t.isArrayExpression(node.arguments[0]))
        ) {
          let selectors = isArray(node.arguments[0].elements)
            ? node.arguments[0].elements
            : node.arguments[0].value.split(" ");

          if (t.isStringLiteral(selectors[0])) {
            selectors = selectors.map(s => s.value);
          }

          let normalSelectors = {};
          let hoverSelectors = {};
          let mediaSelectors = {};
          let mediaHoverSelectors = {};
          let customStyles = {};

          for (let x = 0; x <= selectors.length - 1; x++) {
            if (isNormalSelector(selectors[x])) {
              normalSelectors = { ...normalSelectors, ...getNormalSelectors(selectors[x]) };
            } else if (isHoverSelector(selectors[x])) {
              hoverSelectors = { ...hoverSelectors, ...getHoverSelectors(selectors[x], hoverSelectors) };
            } else if (isMediaSelector(selectors[x])) {
              mediaSelectors = { ...mediaSelectors, ...getMediaSelectors(selectors[x], mediaSelectors) };
            } else if (isMediaHoverSelector(selectors[x])) {
              mediaHoverSelectors = {
                ...mediaHoverSelectors,
                ...getMediaHoverSelectors(selectors[x], mediaHoverSelectors)
              };
            }
          }

          if (t.isObjectExpression(node.arguments[1])) {
            customStyles = convertAstObjectToLiteral(node.arguments[1], t);
          }

          let mergedSelectors = merge(
            normalSelectors,
            hoverSelectors,
            mediaSelectors,
            mediaHoverSelectors,
            customStyles
          );

          let result = serialize(mergedSelectors);

          path.replaceWith(result);
        }
      }
    }
  };
}

export function isNormalSelector(selector) {
  return !selector.includes(":");
}

export function isHoverSelector(selector) {
  return selector.includes(":") && selector.split(":")[0] === "hover";
}

export function isMediaSelector(selector) {
  return (
    selector.includes(":") &&
    selector.split(":").length === 2 &&
    Object.keys(twConfig.screens).some(screen => selector.split(":")[0])
  );
}

export function isMediaHoverSelector(selector) {
  return (
    selector.includes(":") &&
    selector.split(":").length === 3 &&
    Object.keys(twConfig.screens).some(screen => selector.split(":")[0])
  );
}

export function getNormalSelectors(selector) {
  return twObj[`.${selector}`];
}

export function getHoverSelectors(hoverSelector, hoverSelectors) {
  let selector = hoverSelector.split(":")[1];
  return { ":hover": { ...hoverSelectors[":hover"], ...twObj[`.${selector}`] } };
}

export function getMediaSelectors(mediaSelector, mediaSelectors) {
  let mediaSelectorSplit = mediaSelector.split(":");

  let size = mediaSelectorSplit[0];
  let selector = mediaSelectorSplit[1];
  let screen = `@media (min-width: ${twConfig.screens[size]})`;
  return { [screen]: { ...mediaSelectors[screen], ...twObj[`.${selector}`] } };
}

export function getMediaHoverSelectors(mediaHoverSelector, mediaHoverSelectors) {
  let mediaHoverSelectorSplit = mediaHoverSelector.split(":");

  let size = mediaHoverSelectorSplit[0];
  let hover = mediaHoverSelectorSplit[1];
  let selector = mediaHoverSelectorSplit[2];
  let screen = `@media (min-width: ${twConfig.screens[size]})`;

  if (!mediaHoverSelectors.hasOwnProperty(screen)) {
    mediaHoverSelectors[screen] = {};
  }

  if (!mediaHoverSelectors[screen].hasOwnProperty(":hover")) {
    mediaHoverSelectors[screen][":hover"] = {};
  }

  return {
    [screen]: {
      ...mediaHoverSelectors[screen],
      ":hover": { ...mediaHoverSelectors[screen][":hover"], ...twObj[`.${selector}`] }
    }
  };
}

export function formatTailwindObj(obj) {
  return Object.keys(twObj)
    .filter(k => k.includes("."))
    .map(k => {
      let newKey = k.replace("\\", "");
      return { [newKey]: twObj[k] };
    })
    .reduce((acc, x) => {
      for (let key in x) {
        if (key.includes(",")) {
          let splitKey = key.split(",");
          acc[splitKey[0]] = x[key];
          acc[splitKey[1]] = x[key];

          delete acc[key];

          return acc;
        }
        acc[key] = x[key];
      }
      return acc;
    }, {});
}

function convertAstObjectToLiteral(farts, t) {
  return farts.properties.reduce((acc, x) => {
    acc[x.key.value] = x.value.value;

    if (t.isObjectExpression(x.value)) {
      acc[x.key.value] = convertAstObjectToLiteral(x.value, t);
    }

    return acc;
  }, {});
}
