import addFileIcon from "./assets/icons/add-file.png";
import addFolderIcon from "./assets/icons/add-folder.png";
import closeIcon from "./assets/icons/close.png";
import appLogo from "./assets/logo.png";
import documentsIcon from "./assets/icons/documents.png";
import gearIcon from "./assets/icons/gear.png";
import languageIcon from "./assets/icons/language.png";
import openFileIcon from "./assets/icons/open-file.png";
import saveIcon from "./assets/icons/save.png";
import saveAsIcon from "./assets/icons/save-as.png";
import searchIcon from "./assets/icons/search.png";
import sourceCodeIcon from "./assets/icons/source-code.png";
import markdownIcon from "./assets/icons/md-edit.png";
import readIcon from "./assets/icons/open-book.png";
import formatIcon from "./assets/icons/format.png";
import formatOptionsIcon from "./assets/icons/config.png";
import hexIcon from "./assets/icons/hex.png";
import pasteIcon from "./assets/icons/paste.png";
import copyIcon from "./assets/icons/copy.png";
import cutIcon from "./assets/icons/cut.png";
import undoIcon from "./assets/icons/undo.png";
import redoIcon from "./assets/icons/redo.png";

export { addFileIcon, cutIcon, copyIcon, pasteIcon };

function setImg(el: HTMLImageElement | null, src: string) {
  if (el) {
    el.src = src;
  }
}

export function applyToolbarIcons() {
  setImg(document.querySelector("#toolbar-logo"), appLogo);
  setImg(document.querySelector("#btn-new .toolbar-btn-icon"), addFileIcon);
  setImg(document.querySelector("#btn-open .toolbar-btn-icon"), openFileIcon);
  setImg(document.querySelector("#btn-save .toolbar-btn-icon"), saveIcon);
  setImg(document.querySelector("#btn-save-as .toolbar-btn-icon"), saveAsIcon);
  setImg(document.querySelector("#btn-find .toolbar-btn-icon"), searchIcon);
  setImg(document.querySelector("#syntax-icon"), sourceCodeIcon);
  setImg(document.querySelector("#btn-locale .toolbar-btn-icon"), languageIcon);
  setImg(document.querySelector("#btn-md .toolbar-btn-icon"), markdownIcon);
  setImg(document.querySelector("#btn-read .toolbar-btn-icon"), readIcon);
  setImg(document.querySelector("#btn-format .toolbar-btn-icon"), formatIcon);
  setImg(document.querySelector("#btn-format-options .toolbar-btn-icon"), formatOptionsIcon);
  setImg(document.querySelector("#btn-hex .toolbar-btn-icon"), hexIcon);
  setImg(document.querySelector("#btn-paste .toolbar-btn-icon"), pasteIcon);
  setImg(document.querySelector("#btn-copy .toolbar-btn-icon"), copyIcon);
  setImg(document.querySelector("#btn-cut .toolbar-btn-icon"), cutIcon);
  setImg(document.querySelector("#btn-undo .toolbar-btn-icon"), undoIcon);
  setImg(document.querySelector("#btn-redo .toolbar-btn-icon"), redoIcon);
  setImg(document.querySelector("#btn-explorer .activity-btn-icon"), documentsIcon);
  setImg(document.querySelector("#btn-search .activity-btn-icon"), searchIcon);
  setImg(document.querySelector("#btn-explorer-new-file .sidebar-btn-icon"), addFileIcon);
  setImg(document.querySelector("#btn-explorer-new-folder .sidebar-btn-icon"), addFolderIcon);
  setImg(document.querySelector("#btn-explorer-delete .sidebar-btn-icon"), closeIcon);
  setImg(document.querySelector("#btn-settings .activity-btn-icon"), gearIcon);
}
