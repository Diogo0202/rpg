export function downloadText(filename:string,content:string,type="application/json") {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
