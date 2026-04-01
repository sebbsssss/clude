import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'config/theme.dart';
import 'core/router.dart';

void main() => runApp(const ProviderScope(child: CludeMobileApp()));

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
