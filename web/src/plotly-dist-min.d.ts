// plotly.js-dist-min ships no bundled types (@types/plotly.js targets the full
// 'plotly.js' entry). We use the dist-min build for a smaller lazy chunk and
// call it through the loose Plotly type in Plot.tsx, so an ambient module
// declaration is all we need.
declare module 'plotly.js-dist-min'
