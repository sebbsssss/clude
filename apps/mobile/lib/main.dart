import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'config/theme.dart';
import 'core/auth/auth_provider.dart';
import 'core/router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer();
  try {
    await container.read(authNotifierProvider.notifier).restoreSession()
        .timeout(const Duration(seconds: 3));
  } catch (_) {
    // If session restore fails or times out, continue with fresh state
  }
  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const CludeMobileApp(),
    ),
  );
}

class CludeMobileApp extends ConsumerWidget {
  const CludeMobileApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Clude',
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: AppTheme.dark(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.dark,
    );
  }
}
