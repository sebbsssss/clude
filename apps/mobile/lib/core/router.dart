import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/billing/topup_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/chat/guest_chat_screen.dart';
import '../features/login/login_screen.dart';
import '../features/memory/memory_screen.dart';
import '../features/settings/history_screen.dart';
import '../features/settings/settings_screen.dart';
import '../shared/widgets/bottom_nav.dart';
import 'auth/auth_provider.dart';

/// Bridges Riverpod auth state changes to GoRouter's refreshListenable.
class _AuthNotifierBridge extends ChangeNotifier {
  _AuthNotifierBridge(Ref ref) {
    ref.listen(authNotifierProvider, (_, __) {
      notifyListeners();
    });
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final authBridge = _AuthNotifierBridge(ref);

  return GoRouter(
    initialLocation: '/chat',
    refreshListenable: authBridge,
    redirect: (context, state) {
      final auth = ref.read(authNotifierProvider);
      final isLoginRoute = state.matchedLocation == '/login';
      final isGuestRoute = state.matchedLocation == '/guest';
      final hasAccess = auth.isAuthenticated || auth.isGuest;

      if (!hasAccess && !isLoginRoute) return '/login';
      if (hasAccess && isLoginRoute) {
        return auth.isGuest ? '/guest' : '/chat';
      }
      if (auth.isGuest && !isGuestRoute && !isLoginRoute) return '/guest';
      if (auth.isAuthenticated && isGuestRoute) return '/chat';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/guest',
        builder: (context, state) => const GuestChatScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => ScaffoldWithBottomNav(child: child),
        routes: [
          GoRoute(
            path: '/chat',
            builder: (context, state) => const ConversationListScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (context, state) => ActiveChatScreen(
                  conversationId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: '/memory',
            builder: (context, state) => const MemoryPanelScreen(),
          ),
          GoRoute(
            path: '/settings',
            builder: (context, state) => const SettingsScreen(),
          ),
        ],
      ),
      GoRoute(
        path: '/topup',
        builder: (context, state) => const TopUpScreen(),
      ),
      GoRoute(
        path: '/settings/history',
        builder: (context, state) => const HistoryScreen(),
      ),
    ],
  );
});
