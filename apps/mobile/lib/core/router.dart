import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/billing/topup_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/login/login_screen.dart';
import '../features/memory/memory_screen.dart';
import '../features/settings/settings_screen.dart';
import '../shared/widgets/bottom_nav.dart';
import 'auth/auth_provider.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authNotifierProvider);

  return GoRouter(
    initialLocation: '/chat',
    redirect: (context, state) {
      final isLoginRoute = state.matchedLocation == '/login';
      final hasAccess = auth.isAuthenticated || auth.isGuest;
      if (!hasAccess && !isLoginRoute) return '/login';
      if (hasAccess && isLoginRoute) return '/chat';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
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
    ],
  );
});
