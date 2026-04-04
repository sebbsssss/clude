import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';

import 'balance_notifier.dart';
import 'balance_state.dart';

class BalanceChip extends ConsumerStatefulWidget {
  const BalanceChip({super.key});

  @override
  ConsumerState<BalanceChip> createState() => _BalanceChipState();
}

class _BalanceChipState extends ConsumerState<BalanceChip>
    with TickerProviderStateMixin {
  late final AnimationController _deductionController;
  late final AnimationController _additionController;

  @override
  void initState() {
    super.initState();
    _deductionController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _additionController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
  }

  @override
  void dispose() {
    _deductionController.dispose();
    _additionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final balanceState = ref.watch(balanceNotifierProvider);

    ref.listen<BalanceState>(balanceNotifierProvider, (prev, next) {
      if (prev == null || next.previousBalance == null || next.balanceUsdc == null) return;
      if (next.balanceUsdc == next.previousBalance) return;

      if (next.balanceUsdc! < next.previousBalance!) {
        _deductionController.forward(from: 0);
      } else if (next.balanceUsdc! > next.previousBalance!) {
        _additionController.forward(from: 0);
      }
    });

    // Loading shimmer.
    if (balanceState.isLoading && balanceState.balanceUsdc == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Shimmer.fromColors(
          baseColor: Colors.grey.shade800,
          highlightColor: Colors.grey.shade600,
          child: Container(
            width: 60,
            height: 28,
            decoration: BoxDecoration(
              color: Colors.grey,
              borderRadius: BorderRadius.circular(14),
            ),
          ),
        ),
      );
    }

    final hasBalance = balanceState.balanceUsdc != null;
    final displayAmount = balanceState.promoActive
        ? balanceState.promoCreditUsdc
        : balanceState.balanceUsdc;
    final text = hasBalance
        ? '\$${displayAmount?.toStringAsFixed(2) ?? '0.00'}'
        : '—';
    final chipColor = _chipColor(displayAmount);

    Widget chip = GestureDetector(
      onTap: () => context.push('/topup'),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: chipColor.withAlpha(40),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: chipColor.withAlpha(100)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              text,
              style: TextStyle(
                color: chipColor,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (balanceState.promoActive) ...[
              const SizedBox(width: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                decoration: BoxDecoration(
                  color: chipColor,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  'PROMO',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 8,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );

    // Deduction animation: shake.
    chip = AnimatedBuilder(
      animation: _deductionController,
      builder: (context, child) {
        final offset = _deductionController.isAnimating
            ? ((_deductionController.value * 4).round() % 2 == 0 ? 2.0 : -2.0)
            : 0.0;
        return Transform.translate(
          offset: Offset(offset, 0),
          child: child,
        );
      },
      child: chip,
    );

    // Addition animation: scale pop.
    chip = ScaleTransition(
      scale: Tween(begin: 1.0, end: 1.15).animate(CurvedAnimation(
        parent: _additionController,
        curve: Curves.elasticOut,
      )),
      child: chip,
    );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: chip,
    );
  }

  Color _chipColor(double? amount) {
    if (amount == null) return Colors.grey;
    if (amount > 1.00) return const Color(0xFF10B981); // green
    if (amount >= 0.10) return const Color(0xFFF59E0B); // yellow
    return const Color(0xFFEF4444); // red
  }
}
