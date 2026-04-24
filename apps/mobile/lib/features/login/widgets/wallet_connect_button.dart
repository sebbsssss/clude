import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_provider.dart';
import '../../../core/deep_link_service.dart';
import '../../../core/router.dart';

class WalletConnectButton extends ConsumerStatefulWidget {
  const WalletConnectButton({super.key});

  @override
  ConsumerState<WalletConnectButton> createState() =>
      _WalletConnectButtonState();
}

class _WalletConnectButtonState extends ConsumerState<WalletConnectButton> {
  bool _isLoading = false;

  Future<void> _connectWallet() async {
    if (_isLoading) return;

    setState(() => _isLoading = true);

    final deepLinks = ref.read(deepLinkServiceProvider);
    try {
      deepLinks.pause();
      final success =
          await ref.read(authNotifierProvider.notifier).loginWithPrivy();

      if (!mounted) return;

      if (success) {
        final router = ref.read(routerProvider);
        if (deepLinks.pendingRoute != null) {
          deepLinks.consumePendingRoute(router);
        } else {
          context.go('/chat');
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      deepLinks.resume();
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return SizedBox(
      height: 48,
      child: OutlinedButton(
        onPressed: _isLoading ? null : _connectWallet,
        style: OutlinedButton.styleFrom(
          side: BorderSide(
            color: colorScheme.outlineVariant,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
        child: _isLoading
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Row(
                children: [
                  Icon(Icons.account_balance_wallet_outlined,
                      size: 20, color: colorScheme.onSurface),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Continue with a wallet',
                      style: TextStyle(color: colorScheme.onSurface),
                    ),
                  ),
                  Icon(Icons.chevron_right,
                      size: 20,
                      color: colorScheme.onSurface.withValues(alpha: 0.5)),
                ],
              ),
      ),
    );
  }
}
