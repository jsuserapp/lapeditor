use tauri::WebviewWindow;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    },
    PermissionRequestedEventHandler, SetPermissionStateCompletedHandler,
};
use windows::core::{Interface, PCWSTR};

const CLIPBOARD_ORIGINS: &[&str] = &[
    "https://tauri.localhost",
    "http://tauri.localhost",
    "http://localhost:1420",
];

pub fn allow_clipboard_read(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| {
        let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
            return;
        };
        persist_clipboard_allow(&core);
        listen_clipboard_permission(&core);
    });
}

fn persist_clipboard_allow(core: &ICoreWebView2) {
    let Ok(core) = core.cast::<ICoreWebView2_13>() else {
        return;
    };
    let Ok(profile) = (unsafe { core.Profile() }) else {
        return;
    };
    let Ok(profile) = profile.cast::<ICoreWebView2Profile4>() else {
        return;
    };
    for origin in CLIPBOARD_ORIGINS {
        let wide: Vec<u16> = origin.encode_utf16().chain(std::iter::once(0)).collect();
        let done = SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(())));
        let _ = unsafe {
            profile.SetPermissionState(
                COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
                PCWSTR::from_raw(wide.as_ptr()),
                COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                &done,
            )
        };
    }
}

fn listen_clipboard_permission(core: &ICoreWebView2) {
    let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
        if let Some(args) = args {
            let mut kind = COREWEBVIEW2_PERMISSION_KIND(0);
            unsafe { args.PermissionKind(&mut kind)? };
            if kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ {
                unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
            }
        }
        Ok(())
    }));
    let mut token = 0_i64;
    let _ = unsafe { core.add_PermissionRequested(&handler, &mut token) };
}
