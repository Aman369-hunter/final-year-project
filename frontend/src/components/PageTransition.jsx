// Restrained route transition: opacity plus a move of at most 6 px over 180 ms, ease-out,
// no spring or overshoot. Skipped entirely when the user prefers reduced motion
// (App wraps everything in <MotionConfig reducedMotion="user">).
import { motion } from 'framer-motion';

export default function PageTransition({ children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}
