import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_provider.dart';
import 'widgets/api_key_input.dart';
import 'widgets/wallet_connect_button.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    final authState = ref.read(authNotifierProvider);
    if (authState.isLoading) return;

    final notifier = ref.read(authNotifierProvider.notifier);
    final success = await notifier.loginWithApiKey(_controller.text.trim());
    if (success && mounted) {
      context.go('/chat');
    }
  }

  void _continueAsGuest() {
    ref.read(authNotifierProvider.notifier).continueAsGuest();
    context.go('/chat');
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              CircleAvatar(
                radius: 32,
                backgroundColor: Theme.of(context).colorScheme.onSurface,
                child: Text(
                  'C',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.surface,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Clude',
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Persistent memory for your AI agents',
                style: TextStyle(
                  fontSize: 16,
                  color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 48),
              ApiKeyInput(
                controller: _controller,
                errorText: authState.error,
                enabled: !authState.isLoading,
              ),
              const SizedBox(height: 16),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: authState.isLoading ? null : _signIn,
                  child: authState.isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Sign in'),
                ),
              ),
              const SizedBox(height: 24),
              const WalletConnectButton(),
              const SizedBox(height: 16),
              GestureDetector(
                onTap: _continueAsGuest,
                child: Text(
                  'Continue as guest',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.primary,
                    decoration: TextDecoration.underline,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
