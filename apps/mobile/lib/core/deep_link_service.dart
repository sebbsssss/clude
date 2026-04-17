import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:app_links/app_links.dart';

import 'auth/auth_provider.dart';
import 'auth/auth_state.dart';

final deepLinkServiceProvider = Provider<DeepLinkService>((ref) {
  final service = DeepLinkService(ref);
  ref.onDispose(() => service.dispose());
  return service;
});

/// Parses incoming `clude://` deep links and routes them via GoRouter.
///
/// Handles cold start (initial link), warm start, and foreground links.
/// Stores a pending route when the user is not authenticated, to be
/// consumed after login.
class DeepLinkService {
  DeepLinkService(this._ref);

  final Ref _ref;
  String? _pendingRoute;
  StreamSubscription<Uri?>? _linkSub;

  /// Stashed topup callback params for the topup screen to pick up.
  (String, String)? _pendingTopupParams;

  String? get pendingRoute => _pendingRoute;
  (String, String)? get pendingTopupParams => _pendingTopupParams;

  /// Consume and clear stashed topup params.
  (String, String)? consumeTopupParams() {
    final params = _pendingTopupParams;
    _pendingTopupParams = null;
    return params;
  }

  /// Hosts reserved for WalletAuthService — ignore them here.
  static const _walletHosts = {'wallet-connect', 'wallet-sign'};

  /// Parse a `clude://` URI into a GoRouter path or synthetic action.
  ///
  /// Returns `null` for unrecognised or invalid URIs.
  /// Synthetic actions start with `_` (e.g. `_login:`, `_topup:`).
  String? parseRoute(Uri uri) {
    final host = uri.host;
    if (host.isEmpty || _walletHosts.contains(host)) return null;

    switch (host) {
      case 'chat':
        final segments = uri.pathSegments;
        if (segments.isEmpty) return '/chat';
        return '/chat/${segments.first}';

      case 'memory':
        return '/memory';

      case 'login':
        final key = uri.queryParameters['key'];
        if (key == null || !key.startsWith('clk_')) return null;
        return '_login:$key';

      case 'topup':
        final segments = uri.pathSegments;
        if (segments.isEmpty || segments.first != 'callback') return null;
        final intent = uri.queryParameters['intent'];
        final tx = uri.queryParameters['tx'];
        if (intent == null || tx == null) return null;
        return '_topup:$intent:$tx';

      default:
        return null;
    }
  }

  /// Handle an incoming deep link URI.
  ///
  /// Parses the URI, checks auth state, and either navigates directly
  /// or stores the route as pending and redirects to login.
  void handleUri(Uri uri, GoRouter router, AuthState auth) {
    final route = parseRoute(uri);
    if (route == null) return;

    // Login actions: auto-login with the key.
    if (isLoginAction(route)) {
      final key = extractLoginKey(route);
      if (auth.isAuthenticated) {
        // Already authenticated — just go to chat.
        router.go('/chat');
        return;
      }
      _ref.read(authNotifierProvider.notifier).loginWithApiKey(key).then((success) {
        if (success) router.go('/chat');
      }).catchError((_) {
        // Network error or timeout — send to login screen so user can retry.
        router.go('/login');
      });
      return;
    }

    if (!auth.isAuthenticated && !auth.isGuest) {
      _pendingRoute = route;
      router.go('/login');
      return;
    }

    _navigateRoute(route, router);
  }

  /// Navigate to the stored pending route and clear it.
  ///
  /// Call this after successful login to redirect the user to
  /// their original deep link destination.
  void consumePendingRoute(GoRouter router) {
    final route = _pendingRoute;
    if (route == null) return;
    _pendingRoute = null;

    _navigateRoute(route, router);
  }

  /// Navigate for a parsed route, handling topup callbacks specially.
  void _navigateRoute(String route, GoRouter router) {
    if (isTopupCallback(route)) {
      _pendingTopupParams = extractTopupParams(route);
      router.go('/topup');
      return;
    }
    router.go(route);
  }

  /// Initialise deep link handling for cold start and ongoing links.
  Future<void> initialise(GoRouter router) async {
    final appLinks = AppLinks();

    // Cold start: process the initial link that launched the app.
    try {
      final initialUri = await appLinks.getInitialLink();
      if (initialUri != null) {
        final auth = _ref.read(authNotifierProvider);
        handleUri(initialUri, router, auth);
      }
    } catch (_) {
      // getInitialLink can throw on some platforms — ignore.
    }

    // Warm start / foreground: listen for incoming links.
    // Read live auth state on each event — not a stale snapshot.
    _linkSub?.cancel();
    _linkSub = appLinks.uriLinkStream.listen((uri) {
      final auth = _ref.read(authNotifierProvider);
      handleUri(uri, router, auth);
    });
  }

  /// Pause the stream listener while another service (e.g. WalletAuthService)
  /// needs exclusive access to `uriLinkStream`.
  void pause() => _linkSub?.pause();

  /// Resume the stream listener after the other service is done.
  void resume() => _linkSub?.resume();

  /// Cancel the URI stream subscription.
  void dispose() {
    _linkSub?.cancel();
    _linkSub = null;
  }

  // --- Static helpers for synthetic action routes ---

  static bool isLoginAction(String? route) {
    return route != null && route.startsWith('_login:');
  }

  static String extractLoginKey(String route) {
    return route.substring('_login:'.length);
  }

  static bool isTopupCallback(String? route) {
    return route != null && route.startsWith('_topup:');
  }

  static (String, String) extractTopupParams(String route) {
    final payload = route.substring('_topup:'.length);
    final idx = payload.indexOf(':');
    return (payload.substring(0, idx), payload.substring(idx + 1));
  }
}
