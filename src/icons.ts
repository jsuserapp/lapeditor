import addFileIcon from "./assets/icons/add-file.png";
import languageIcon from "./assets/icons/language.png";
import openedFolderIcon from "./assets/icons/opened-folder.png";
import saveIcon from "./assets/icons/save.png";
import saveAsIcon from "./assets/icons/save-as.png";
import searchIcon from "./assets/icons/search.png";
import sourceCodeIcon from "./assets/icons/source-code.png";
import markdownIcon from "./assets/icons/md.png";

export { addFileIcon };

function setImg(el: HTMLImageElement | null, src: string) {
  if (el) {
    el.src = src;
  }
}

export function applyToolbarIcons() {
  setImg(document.querySelector("#btn-new .toolbar-btn-icon"), addFileIcon);
  setImg(document.querySelector("#btn-open .toolbar-btn-icon"), openedFolderIcon);
  setImg(document.querySelector("#btn-save .toolbar-btn-icon"), saveIcon);
  setImg(document.querySelector("#btn-save-as .toolbar-btn-icon"), saveAsIcon);
  setImg(document.querySelector("#btn-find .toolbar-btn-icon"), searchIcon);
  setImg(document.querySelector("#syntax-icon"), sourceCodeIcon);
  setImg(document.querySelector("#btn-locale .toolbar-btn-icon"), languageIcon);
  setImg(document.querySelector("#btn-md .toolbar-btn-icon"), markdownIcon);
}
